// Executado antes de cada arquivo de teste (antes de importar o app)
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.PUSH_ALLOWED_HOSTS = '127.0.0.1';
process.env.ALLOW_SIGNUP = 'true';
// chaves VAPID fixas apenas para testes
process.env.VAPID_PUBLIC_KEY = 'BNQo0h17P3bLcp4XD9Yn9KDzUwfSWbxisv1lqe6IRQpq2_4svCAyPLab5pgkleD9tghUHUPkR8dxobO_x2r2oOA';
process.env.VAPID_PRIVATE_KEY = 'OvM9amXWXVV0iE67b8EnrGvhOO0utJT7FX9v3kRoygQ';
process.env.VAPID_SUBJECT = 'mailto:teste@myday.app';
