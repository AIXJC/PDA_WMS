const fs = require('fs');
const s = fs.readFileSync('index.js', 'utf8');
const start = s.indexOf('INSERT INTO INVENTORY_REQUESTS');
const end = s.indexOf(');', start);
const query = s.slice(start, end + 2);
console.log(query);
console.log('questionMarks', (query.match(/\?/g) || []).length);
console.log('valuesCountExpected', (query.match(/VALUES\s*\(/) ? 1 : 0));
