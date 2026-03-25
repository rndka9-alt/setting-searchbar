export const PORT = Number(process.env['PORT'] || 3004);
export const UPSTREAM = new URL(process.env['UPSTREAM'] || 'http://localhost:6001');
export const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
