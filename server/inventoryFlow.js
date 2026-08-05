function shouldApplyInventoryUpdate(requestStatusId, requestTypeId, lotInventoryId) {
  const statusId = Number(requestStatusId);
  const typeId = Number(requestTypeId);
  const lotId = Number(lotInventoryId);

  if (![41, 42].includes(statusId)) return false;
  if (![2, 3, 6, 12].includes(typeId)) return false;
  if (!Number.isInteger(lotId) || lotId <= 0) return false;

  return true;
}

function getInventoryDelta(requestStatusId) {
  const statusId = Number(requestStatusId);
  if (statusId === 41) return 1;
  if (statusId === 42) return -1;
  return 0;
}

async function upsertInventoryFromLot(connection, { requestId, lotInventoryId, partNumber, quantity, sourceLocationId, destinationLocationId, userId, comments, requestStatusId, requestTypeId }) {
  const lotId = Number(lotInventoryId);
  if (!Number.isInteger(lotId) || lotId <= 0) return { applied: false, reason: 'lot_inventory_missing' };
  if (!shouldApplyInventoryUpdate(requestStatusId, requestTypeId, lotId)) {
    return { applied: false, reason: 'status_not_applicable' };
  }

  const [lotRows] = await connection.query(
    'SELECT LotInventoryID, InventoryID, CurrentQuantity, CurrentLocationID, CurrentInternalLot FROM MES_LOT_INVENTORY WHERE LotInventoryID = ? LIMIT 1',
    [lotId]
  );
  const lotRow = lotRows[0];
  if (!lotRow) return { applied: false, reason: 'lot_not_found' };

  const normalizedPartNumber = String(partNumber || '').trim();
  const parsedQty = Number(quantity);
  const quantityToApply = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : Number(lotRow.CurrentQuantity || 0);
  const delta = getInventoryDelta(requestStatusId);
  const signedQuantity = delta !== 0 ? quantityToApply * delta : quantityToApply;

  let inventoryId = lotRow.InventoryID != null ? Number(lotRow.InventoryID) : null;
  if (!inventoryId) {
    const [inventoryRows] = await connection.query(
      'SELECT InventoryID FROM MES_INVENTORY WHERE PartNumber = ? ORDER BY InventoryID DESC LIMIT 1',
      [normalizedPartNumber]
    );
    inventoryId = inventoryRows[0]?.InventoryID != null ? Number(inventoryRows[0].InventoryID) : null;
  }

  // MES_INVENTORY.RackLocationID es NOT NULL, así que necesitamos un valor válido sí o sí.
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

  // INVENTORY_MOVEMENTS_HISTORY tiene SourceLocationID, DestinationLocationID, RegUserID y
  // ConfirmUserID como NOT NULL. Si falta cualquiera, fallamos con un mensaje claro
  // en vez de dejar que MySQL reviente con un error críptico que además hace rollback
  // silencioso de todo (incluido el cambio de status 41->42).
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
    2,
    safeSourceLocationId,
    safeDestinationLocationId,
    safeUserId,
    safeUserId,
    comments || 'Inventario actualizado desde solicitud aprobada',
    lotRow.CurrentInternalLot || null,
    lotRow.CurrentInternalLot || null,
  ]);

  return { applied: true, inventoryId, lotInventoryId: lotId, quantity: signedQuantity, movementId: movementResult.insertId };
}

// Revierte el movimiento de inventario más reciente registrado para una solicitud,
// deshaciendo exactamente lo que hicieron upsertInventoryFromLot (transferencias /
// consumo, MovementTypeID=2) o la aprobación de scrap (MovementTypeID=6). Se usa
// cuando la sincronización con el ERP (submit-stock-entry) falla después de que la
// solicitud ya quedó marcada como ejecutada (RequestStatusID=42) en MES_DB.
async function reverseSubmittedMovement(connection, { requestId, requestTypeId, lotInventoryId, sourceLocationId }) {
  const [movementRows] = await connection.query(
    'SELECT MovementID, Quantity, MovementTypeID FROM INVENTORY_MOVEMENTS_HISTORY WHERE RequestID = ? ORDER BY MovementID DESC LIMIT 1 FOR UPDATE',
    [requestId]
  );
  const movement = movementRows[0];
  if (!movement) return { reversed: false, reason: 'movement_not_found' };

  const quantity = Number(movement.Quantity || 0);
  const isScrapMovement = Number(movement.MovementTypeID) === 6;

  if (!lotInventoryId) return { reversed: false, reason: 'lot_inventory_missing' };

  await connection.query(
    'UPDATE MES_LOT_INVENTORY SET CurrentQuantity = CurrentQuantity + ? WHERE LotInventoryID = ?',
    [quantity, lotInventoryId]
  );

  if (isScrapMovement) {
    await connection.query('DELETE FROM MES_SCRAP_AND_DISCREPANCIES WHERE MovementID = ?', [movement.MovementID]);
  } else {
    // Solo la transferencia completa (no la parcial/consumo) mueve la ubicación del lote.
    if (Number(requestTypeId) === 2 && sourceLocationId != null) {
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
    if (inventoryId) {
      await connection.query(
        'UPDATE MES_INVENTORY SET Quantity = Quantity + ?, LastUpdate = NOW() WHERE InventoryID = ?',
        [quantity, inventoryId]
      );
    }
  }

  await connection.query('DELETE FROM INVENTORY_MOVEMENTS_HISTORY WHERE MovementID = ?', [movement.MovementID]);

  return { reversed: true, movementId: movement.MovementID, quantity, wasScrapMovement: isScrapMovement };
}

export { shouldApplyInventoryUpdate, getInventoryDelta, upsertInventoryFromLot, reverseSubmittedMovement };
