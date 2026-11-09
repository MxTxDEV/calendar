import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('# Adicione ao seu arquivo .env (mantenha a chave privada em segredo):');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:seu-email@exemplo.com');
