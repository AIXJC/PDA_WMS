import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInboundTransferRequestPayload } from '../receiptFlow.js';

test('builds a transfer request payload from a receipt confirmation', () => {
  const payload = buildInboundTransferRequestPayload({
    partNumber: 'BL-320',
    quantity: 10,
    sourceLocationId: 3,
    destinationLocationId: 5,
    requestUserId: 7,
    lotReference: 'BWL26072000014',
    comments: 'Recepción completada',
  });

  assert.equal(payload.RequestTypeID, 2);
  assert.equal(payload.RequestStatusID, 40);
  assert.equal(payload.PartNumber, 'BL-320');
  assert.equal(payload.Quantity, 10);
  assert.equal(payload.SourceLocationID, 3);
  assert.equal(payload.DestinationLocationID, 5);
  assert.equal(payload.RegUserID, 7);
  assert.equal(payload.LotReceiveID, 'BWL26072000014');
  assert.match(payload.Comments, /Recepción completada/);
});

test('includes lot inventory when provided so the request can be traced to a specific lot', () => {
  const payload = buildInboundTransferRequestPayload({
    partNumber: 'BL-320',
    quantity: 4,
    sourceLocationId: 3,
    destinationLocationId: 5,
    requestUserId: 7,
    lotInventoryId: 88,
    lotReference: 'BWL26072000014',
    comments: 'Auto-created from inbound confirmation',
  });

  assert.equal(payload.LotInventoryID, 88);
  assert.equal(payload.LotReceiveID, 'BWL26072000014');
});
