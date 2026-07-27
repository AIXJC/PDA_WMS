const url = 'http://localhost:3001/api/requests';
const body = {
  RequestTypeID: 3,
  PartNumber: 'BL-322',
  Quantity: 1,
  RegUserID: 1,
  SourceLocationID: 129,
  LotReceiveID: 187
};

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log(text);
  } catch (err) {
    console.error('ERROR', err);
  }
})();
