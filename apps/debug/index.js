require('dotenv').config();

const { createApp } = require('./debug'),
    { createSessionStore } = require('./lib/session-store'),
    config = require('./config');

console.log(`${config.appName} ${config.appVersion}`);

const sessionStore = createSessionStore();
const app = createApp({ sessionStore });

const server = app
    .listen(config.port, () => {
        console.log(`Listening on port ${server.address().port} — public URL: ${config.publicUrl}`);
    })
    .on('error', error => {
        switch (error.code) {
        case 'EADDRINUSE':
            console.log(`Error: Port ${config.port} is already in use.`);
            break;
        default:
            console.log(error.code);
        }
    });

app.locals.attachSessionSockets(server);

const gcTimer = setInterval(() => {
    sessionStore.sweep(config.sessionGcIdleMs);
}, config.sessionGcIntervalMs);
server.on('close', () => clearInterval(gcTimer));
