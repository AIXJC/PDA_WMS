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

  if (!inventoryId) {
    const [insertResult] = await connection.query(
      'INSERT INTO MES_INVENTORY (PartNumber, RackLocationID, Quantity, LastUpdate) VALUES (?, ?, ?, NOW())',
      [normalizedPartNumber, sourceLocationId || destinationLocationId || null, signedQuantity]
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
    [inventoryId, signedQuantity, destinationLocationId || sourceLocationId || null, lotId]
  );

  await connection.query(`
    INSERT INTO INVENTORY_MOVEMENTS_HISTORY (
      RequestID, PartNumber, StorageID, Quantity, MovementTypeID,
      SourceLocationID, DestinationLocationID, RegUserID, ConfirmUserID,
      Comments, OriginalInternalLot, NewInternalLot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    requestId,
    normalizedPartNumber,
    destinationLocationId || sourceLocationId || null,
    quantityToApply,
    2,
    sourceLocationId || null,
    destinationLocationId || null,
    userId || null,
    userId || null,
    comments || 'Inventario actualizado desde solicitud aprobada',
    lotRow.CurrentInternalLot || null,
    lotRow.CurrentInternalLot || null,
  ]);

  return { applied: true, inventoryId, lotInventoryId: lotId, quantity: signedQuantity };
}

export { shouldApplyInventoryUpdate, getInventoryDelta, upsertInventoryFromLot };
