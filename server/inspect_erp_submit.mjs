import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const url = process.env.ERP_SUBMIT_STOCK_ENTRY_URL;
const body = { request_id: 30, quantity: 10, batch_no: 'BL-320' };
const token = process.env.ERP_API_TOKEN;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `token ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

console.log('status', res.status);
console.log(await res.text());
