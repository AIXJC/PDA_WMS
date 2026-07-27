export function buildInboundTransferRequestPayload({
  partNumber,
  quantity,
  sourceLocationId,
  destinationLocationId,
  requestUserId,
  lotReference,
  comments,
}) {
  const parsedQty = Number(quantity);
  const parsedSourceLocationId = sourceLocationId !== undefined && sourceLocationId !== null && sourceLocationId !== ''
    ? Number(sourceLocationId)
    : undefined;
  const parsedDestinationLocationId = destinationLocationId !== undefined && destinationLocationId !== null && destinationLocationId !== ''
    ? Number(destinationLocationId)
    : undefined;

  return {
    RequestTypeID: 2,
    RequestStatusID: 40,
    PartNumber: String(partNumber || '').trim(),
    Quantity: Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1,
    RegUserID: requestUserId !== undefined && requestUserId !== null && requestUserId !== '' ? Number(requestUserId) : undefined,
    SourceLocationID: Number.isFinite(parsedSourceLocationId) ? parsedSourceLocationId : undefined,
    DestinationLocationID: Number.isFinite(parsedDestinationLocationId) ? parsedDestinationLocationId : undefined,
    Comments: String(comments || '').trim() || undefined,
    LotReceiveID: lotReference !== undefined && lotReference !== null && lotReference !== '' ? String(lotReference) : undefined,
  };
}
