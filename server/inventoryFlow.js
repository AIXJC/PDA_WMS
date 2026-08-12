function shouldApplyInventoryUpdate(requestStatusId, requestTypeId, lotInventoryId) {
  const statusId = Number(requestStatusId);
  const typeId = Number(requestTypeId);
  const lotId = Number(lotInventoryId);

  if (![41, 42].includes(statusId)) return false;
  if (![2, 3, 6, 12].includes(typeId)) return false;
  if (!Number.isInteger(lotId) || lotId <= 0) return false;

  return true;
}

// Una solicitud solo puede ejecutarse (pasar de aprobada a confirmada) una
// vez. Si ya está en 42 no debe volver a entrar al flujo: eso es lo que
// permitía la doble ejecución que revertía un 42 legítimo de vuelta a 41.
function canExecuteTransfer(requestStatusId) {
  return Number(requestStatusId) === 41;
}

function getInventoryDelta(requestStatusId) {
  const statusId = Number(requestStatusId);
  if (statusId === 41) return 1;
  if (statusId === 42) return -1;
  return 0;
}

// Un registro de MES_INVENTORY sin cantidad ya no representa material físico en ese
// rack, así que se elimina en vez de dejarlo en cero: si más adelante vuelve a
// entrar material a ese mismo rack se crea un registro nuevo (mismo patrón ya usado
// para altas). Cualquier lote que todavía apunte a este InventoryID pierde esa
// referencia (queda NULL) para no dejar una relación colgando.
async function deleteInventoryRowIfEmpty(connection, inventoryId) {
  if (!inventoryId) return false;
  const [rows] = await connection.query('SELECT Quantity FROM MES_INVENTORY WHERE InventoryID = ?', [inventoryId]);
  const row = rows[0];
  if (!row || Number(row.Quantity) > 0) return false;
  await connection.query('UPDATE MES_LOT_INVENTORY SET InventoryID = NULL WHERE InventoryID = ?', [inventoryId]);
  await connection.query('DELETE FROM MES_INVENTORY WHERE InventoryID = ?', [inventoryId]);
  return true;
}

async function upsertInventoryFromLot(connection, { requestId, lotInventoryId, partNumber, quantity, sourceLocationId, destinationLocationId, userId, comments, requestStatusId, requestTypeId }) {
  const lotId = Number(lotInventoryId);
  if (!Number.isInteger(lotId) || lotId <= 0) return { applied: false, reason: 'lot_inventory_missing' };
  if (!shouldApplyInventoryUpdate(requestStatusId, requestTypeId, lotId)) {
    return { applied: false, reason: 'status_not_applicable' };
  }

  // Idempotencia: si ya existe un movimiento registrado para este RequestID,
  // no lo volvemos a aplicar. Sin esto, una segunda invocación accidental
  // (llamador duplicado, reintento, etc.) descontaría/sumaría inventario dos
  // veces y volvería a someter el movimiento al ERP, que lo rechazaría por
  // duplicado y dispararía una reversión que deshace el resultado correcto
  // de la primera ejecución.
  const [existingMovementRows] = await connection.query(
    'SELECT MovementID FROM INVENTORY_MOVEMENTS_HISTORY WHERE RequestID = ? AND MovementTypeID = 2 LIMIT 1',
    [requestId]
  );
  if (existingMovementRows[0]) {
    return { applied: false, reason: 'already_applied', movementId: existingMovementRows[0].MovementID };
  }

  const [lotRows] = await connection.query(
    'SELECT LotInventoryID, InventoryID, CurrentQuantity, CurrentLocationID, CurrentInternalLot FROM MES_LOT_INVENTORY WHERE LotInventoryID = ? LIMIT 1',
    [lotId]
  );
  const lotRow = lotRows[0];
  if (!lotRow) return { applied: false, reason: 'lot_not_found' };

  const normalizedPartNumber = String(partNumber || '').trim();
  const parsedQty = Number(quantity);
  let quantityToApply = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : Number(lotRow.CurrentQuantity || 0);
  
  // ========== CAMBIO AQUÍ ==========
  // Calcular delta según tipo de solicitud
  let delta = 0;
  if (requestStatusId === 42) {
    // Restan: Consumo (3), Scrap (6), Transferencia parcial (12)
    if ([3, 6, 12].includes(requestTypeId)) {
      delta = -1;
    } else {
      delta = 0; // Transferencia (2), Ajuste (7), Devolución (8) NO restan
    }
  } 
  
  const signedQuantity = delta !== 0 ? quantityToApply * delta : 0;
  // ========== FIN CAMBIO ==========

  let inventoryId = lotRow.InventoryID != null ? Number(lotRow.InventoryID) : null;
  if (!inventoryId) {
    const [inventoryRows] = await connection.query(
      'SELECT InventoryID FROM MES_INVENTORY WHERE PartNumber = ? ORDER BY InventoryID DESC LIMIT 1',
      [normalizedPartNumber]
    );
    inventoryId = inventoryRows[0]?.InventoryID != null ? Number(inventoryRows[0].InventoryID) : null;
  }

  const rackLocationId = destinationLocationId || sourceLocationId || null;
  if (!inventoryId && !rackLocationId) {
    throw new Error(`No se pudo determinar RackLocationID para crear MES_INVENTORY (PartNumber=${normalizedPartNumber}).`);
  }

  if (!inventoryId) {
    const [insertResult] = await connection.query(
      'INSERT INTO MES_INVENTORY (PartNumber, RackLocationID, Quantity, LastUpdate) VALUES (?, ?, ?, NOW())',
      [normalizedPartNumber, rackLocationId, signedQuantity]
    );
    inventoryId = Number(insertResult.insertId || 0);
  } else {
    await connection.query(
      'UPDATE MES_INVENTORY SET Quantity = Quantity + ?, LastUpdate = NOW() WHERE InventoryID = ?',
      [signedQuantity, inventoryId]
    );
  }

  await connection.query(
    'UPDATE MES_LOT_INVENTORY SET InventoryID = ?, CurrentQuantity = COALESCE(CurrentQuantity, 0) + ?, CurrentLocationID = COALESCE(CurrentLocationID, ?) WHERE LotInventoryID = ?',
    [inventoryId, signedQuantity, rackLocationId, lotId]
  );

  const safeSourceLocationId = sourceLocationId || destinationLocationId || null;
  const safeDestinationLocationId = destinationLocationId || sourceLocationId || null;
  const safeUserId = userId || null;

  const missing = [];
  if (!safeSourceLocationId) missing.push('SourceLocationID');
  if (!safeDestinationLocationId) missing.push('DestinationLocationID');
  if (!safeUserId) missing.push('RegUserID/ConfirmUserID');
  if (missing.length) {
    throw new Error(`Faltan datos requeridos para registrar el movimiento (${missing.join(', ')}), RequestID=${requestId}.`);
  }

  const isScrap = Number(requestTypeId) === 6;
  const movementTypeId = isScrap ? 6 : 2;

  const [movementResult] = await connection.query(`
    INSERT INTO INVENTORY_MOVEMENTS_HISTORY (
      RequestID, PartNumber, StorageID, Quantity, MovementTypeID,
      SourceLocationID, DestinationLocationID, RegUserID, ConfirmUserID,
      Comments, OriginalInternalLot, NewInternalLot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    requestId,
    normalizedPartNumber,
    rackLocationId,
    quantityToApply,
    movementTypeId,
    safeSourceLocationId,
    safeDestinationLocationId,
    safeUserId,
    safeUserId,
    comments || 'Inventario actualizado desde solicitud aprobada',
    lotRow.CurrentInternalLot || null,
    lotRow.CurrentInternalLot || null,
  ]);

  const movementId = movementResult.insertId;

  if (isScrap) {
    await connection.query(`
      INSERT INTO MES_SCRAP_AND_DISCREPANCIES (
        PartNumber, Quantity, LocationID, RegUserID, Comments, MovementID, LotInventoryID
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      normalizedPartNumber,
      quantityToApply,
      safeSourceLocationId,
      safeUserId,
      comments || 'Scrap confirmado desde solicitud aprobada',
      movementId,
      lotId,
    ]);
  }

  return { applied: true, inventoryId, lotInventoryId: lotId, quantity: signedQuantity, movementId };
}

// Revierte el movimiento de inventario más reciente registrado para una solicitud,
// deshaciendo exactamente lo que hicieron upsertInventoryFromLot (transferencias /
// consumo, MovementTypeID=2) o la aprobación de scrap (MovementTypeID=6). Se usa
// cuando la sincronización con el ERP (submit-stock-entry) falla después de que la
// solicitud ya quedó marcada como ejecutada (RequestStatusID=42) en MES_DB.
async function reverseSubmittedMovement(connection, { requestId, requestTypeId, lotInventoryId, sourceLocationId, extraInventoryAdjustment }) {
  const [movementRows] = await connection.query(
    'SELECT MovementID, Quantity, MovementTypeID FROM INVENTORY_MOVEMENTS_HISTORY WHERE RequestID = ? ORDER BY MovementID DESC LIMIT 1 FOR UPDATE',
    [requestId]
  );
  const movement = movementRows[0];
  if (!movement) return { reversed: false, reason: 'movement_not_found' };

  const quantity = Number(movement.Quantity || 0);
  const isScrapMovement = Number(movement.MovementTypeID) === 6;
  const typeId = Number(requestTypeId);
  // Solo consumo, scrap y transferencia parcial (3, 6, 12) restan CurrentQuantity al
  // aplicarse (ver el cálculo de `delta` en upsertInventoryFromLot); la transferencia
  // completa (2) únicamente mueve CurrentLocationID y nunca toca la cantidad, así que
  // revertirla no debe sumarla de vuelta — hacerlo duplicaría la cantidad del lote.
  const quantityWasDeducted = [3, 6, 12].includes(typeId);

  if (!lotInventoryId) return { reversed: false, reason: 'lot_inventory_missing' };

  if (quantityWasDeducted) {
    await connection.query(
      'UPDATE MES_LOT_INVENTORY SET CurrentQuantity = CurrentQuantity + ? WHERE LotInventoryID = ?',
      [quantity, lotInventoryId]
    );
  }

  if (isScrapMovement) {
    await connection.query('DELETE FROM MES_SCRAP_AND_DISCREPANCIES WHERE MovementID = ?', [movement.MovementID]);
  } else {
    // Solo la transferencia completa y el consumo a producción mueven la ubicación
    // del lote (la parcial no, ver upsertInventoryFromLot).
    if ([2, 3].includes(typeId) && sourceLocationId != null) {
      await connection.query(
        'UPDATE MES_LOT_INVENTORY SET CurrentLocationID = ? WHERE LotInventoryID = ?',
        [sourceLocationId, lotInventoryId]
      );
    }

    const [lotRows] = await connection.query(
      'SELECT InventoryID FROM MES_LOT_INVENTORY WHERE LotInventoryID = ?',
      [lotInventoryId]
    );
    const inventoryId = lotRows[0]?.InventoryID ?? null;
    if (inventoryId && quantityWasDeducted) {
      await connection.query(
        'UPDATE MES_INVENTORY SET Quantity = Quantity + ?, LastUpdate = NOW() WHERE InventoryID = ?',
        [quantity, inventoryId]
      );
    }
  }

  // Ajuste explícito fuera del cálculo genérico de arriba (p.ej. el descuento de
  // MES_INVENTORY del rack de origen en una transferencia Storage → Purgue): se revierte
  // sumando de vuelta la cantidad que se le restó al confirmar.
  if (extraInventoryAdjustment && extraInventoryAdjustment.inventoryId) {
    await connection.query(
      'UPDATE MES_INVENTORY SET Quantity = Quantity + ?, LastUpdate = NOW() WHERE InventoryID = ?',
      [extraInventoryAdjustment.quantity, extraInventoryAdjustment.inventoryId]
    );
  }

  await connection.query('DELETE FROM INVENTORY_MOVEMENTS_HISTORY WHERE MovementID = ?', [movement.MovementID]);

  return { reversed: true, movementId: movement.MovementID, quantity, wasScrapMovement: isScrapMovement };
}

async function getStorageFromLot(connection, requestId) {
  const [rows] = await connection.query(`
    SELECT
      sl.StorageID,
      req.PartNumber,
      li.CurrentInternalLot,
      inv.InventoryID
    FROM INVENTORY_REQUESTS req
    INNER JOIN MES_LOT_INVENTORY li
      ON li.LotInventoryID = req.LotInventoryID
    INNER JOIN MES_INVENTORY inv
      ON inv.InventoryID = li.InventoryID
    INNER JOIN STORAGE_LOCATIONS sl
      ON sl.StorageID = inv.RackLocationID
    WHERE req.RequestID = ?
      AND li.CurrentLocationID = 5
    LIMIT 1
  `, [requestId]);

  return rows[0] || null;
}

export { shouldApplyInventoryUpdate, canExecuteTransfer, getInventoryDelta, upsertInventoryFromLot, reverseSubmittedMovement, getStorageFromLot, deleteInventoryRowIfEmpty };
