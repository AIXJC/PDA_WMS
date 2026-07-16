import bcrypt from 'bcryptjs';

const pin = '123456';
const hash = bcrypt.hashSync(pin, 10);
console.log(hash);
