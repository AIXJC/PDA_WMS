const payload = {
  RequestTypeID: 2,
  PartNumber: 'BL-327',
  Quantity: 10,
  RegUserID: 1,
  Comments: '',
  SourceLocationID: 3,
  DestinationLocationID: 4,
  LotReceiveID: 248,
  LotInventoryID: 25,
};

(async () => {
  try {
    const res = await fetch('http://localhost:5173/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log('status', res.status);
    console.log(text);
  } catch (error) {
    console.error(error);
  }
})();
