const express = require('express');
const WebSocket = require('ws');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
let wsSymbols;
let wsTrades;

let forceClose = false;
let forceCloseTrades = false;

app.get('/', (req, res) => {
    res.send({
        symbols: wsSymbols ? 'running' : 'stopped',
        trades: wsTrades ? 'running' : 'stopped',
    });
});

app.get('/start', (req, res) => {
    let response = {
        trades: null,
        symbols: null,
    };

    if(!wsTrades){
        connectWebsocketTrade();
        response.trades = true;
    }

    if(!wsSymbols){
        connectWebsocketSymbols();
        response.symbols = true;
    }

    res.send(response);
});

app.get('/stop', (req, res) => {
    let response = {
        symbol: null,
        trade: null,
    };

    if(closeTradeWebsocket(true)){
        response.trade = 'stopped';
    }

    if(closeSymbolWebsocket(true)){
        response.symbol = 'stopped';
    }

    sendSystemNotify('<b>Servidor de Track: </b>Servidor de track desligado via API');

    res.send(response);
});

app.get('/restart', (req, res) => {
    sendSystemNotify('<b>Servidor de Track: </b>Solicitação de restart via API');

    let response = {
        symbol: null,
        trade: null,
    };

    if(closeTradeWebsocket(true)){
        connectWebsocketTrade();

        if(wsTrades){
            response.trade = 'running';
        }
    }

    if(closeSymbolWebsocket(true)){
        connectWebsocketSymbols();
    
        if(wsSymbols){
            response.symbol = 'running';
        }
    }

    res.send(response);
});

const getSymbolsWebsocket = async () => {
    let string = '';

    try {
        const response = await axios.get(process.env.APINOTIFY + `/v1/trade/symbol`);

        if (response.data.data.itens.length > 0) {
            response.data.data.itens.forEach((e, i) => {
                string += e.symbol.toLowerCase() + "@ticker";
                if (i !== (response.data.data.itens.length - 1)) {
                    string += "/";
                }
            });
        }
    } catch (error) {
        sendSystemNotify('<b>Servidor de Track: </b>Track de pares: Erro ao registrar a cotação no sistema');
    }

    return string;
};

const reconnectWebsocketSymbols = () => {
    sendSystemNotify('<b>Servidor de Track: </b>Track de pares: Tentando reconexão...');

    setTimeout(() => {
        connectWebsocketSymbols();
    }, 5000);
}

const reconnectWebsocketTrades = () => {
    sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Tentando reconexão...');

    setTimeout(() => {
        connectWebsocketTrade();
    }, 5000);
}

const closeSymbolWebsocket = () => {
    forceClose = true;

    if(wsSymbols){
        wsSymbols.close();
        wsSymbols = undefined;
    }

    return true;
};

const closeTradeWebsocket = () => {
    forceCloseTrades = true;

    if(wsTrades){
        wsTrades.close();
        wsTrades = undefined;
    }

    return true;
}

const sendRequestTrack = (data) => {
    return axios.put(process.env.APINOTIFY + `/v1/trade/symbol/cotation`, data).then(response => {
        return;
    }).catch(error => {
        console.log(error);
        console.log('Erro ao enviar requisição a Satoshi');
    });
}

const sendSystemNotify = async (message) => {
    try {
        const response = await axios.post(process.env.APINOTIFY + '/v1/notify', {
            type: 'systemWarning',
            message: message
        });
    } catch (error) {
        console.log(error);
        console.error('Erro na requisição de notificação');
    }
};

const connectWebsocketSymbols = async () => {
    forceClose = false;

    const symbols = await getSymbolsWebsocket();

    const url = process.env.WSDATABINANCE + ':9443/ws/' + symbols;
    wsSymbols = new WebSocket(url);

    wsSymbols.on('open', () => {
        sendSystemNotify('<b>Servidor de Track: </b>Track de pares: Conectado');
    });

    wsSymbols.on('message', (data) => {
        const msg = JSON.parse(data);

        sendRequestTrack({
            symbol: msg.s,
            close: msg.c,
        });
    });

    wsSymbols.on('close', () => {
        sendSystemNotify('<b>Servidor de Track: </b>Track de pares: Conexão fechada...');
        if(forceClose == false){
            reconnectWebsocketSymbols();
        }
    });

    wsSymbols.on('error', (erro) => {
        sendSystemNotify('<b>Servidor de Track: </b>Track de pares: <b>Erro: </b>' + erro.message);
    });
}

const getCredentialsBinance = async () => {
    const request = await axios.get(process.env.APINOTIFY + `/v1/integration/binance/credential`);
    return request;
}

const connectWebsocketTrade = async () => {
    forceCloseTrades = false;

    const getKeyBinance = await getCredentialsBinance();

    if(getKeyBinance.data.data.key){
        try {
            const response = await axios.post(process.env.APIBINANCE + '/api/v3/userDataStream', null, {
                headers: {'X-MBX-APIKEY': getKeyBinance.data.data.key},
            });

            wsTrades = new WebSocket(process.env.WSBINANCE  + `:9443/ws/` + response.data.listenKey);

            wsTrades.on('open', () => {
                sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Conectado');
            });

            wsTrades.on('message', (msg) => {
                const data = JSON.parse(msg);
                
                if(data.e == 'executionReport'){
                    try {
                        const response = axios.put(process.env.APINOTIFY + `/v1/trade/order/track`, {
                            price: data.p,
                            quantity: data.q,
                            symbol: data.s,
                            side: data.S,
                            orderType: data.o,
                            orderId: data.i,
                            orderStatus: data.X,
                            lastQuantity: data.l,
                            executionType: data.x,
                            comission: {
                                amount: data.n,
                                currency: data.N,
                            },
                        });
                    } catch (error) {
                        sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Erro ao enviar notificação de transação');
                    }
                }else if(data.e == 'outboundAccountPosition'){
                    try {
                        var response = axios.put(process.env.APINOTIFY + `/v1/integration/binance/balance`, data);
                    } catch (error) {
                        sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Erro ao enviar notificação de alteração de saldo da carteira');
                    }
                }
            });

            wsTrades.on('close', (e) => {
                // console.log(e);
                sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Conexão fechada...');
                if(forceCloseTrades == false){
                    reconnectWebsocketTrades();
                }
            });

            wsTrades.on('error', (erro) => {
                // console.log(erro);
                sendSystemNotify('<b>Servidor de Track: </b>Track de trades: <b>Erro: </b>' + erro.message);
            });
        } catch (error) {
            // console.log(error);
            sendSystemNotify('<b>Servidor de Track: </b>Track de trades: Erro ao gerar credenciais Binance...');
        }
    }
}

app.listen(process.env.PORT || 3000, () => {});