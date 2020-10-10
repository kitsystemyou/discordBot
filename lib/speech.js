class Speech {
    constructor(client) {
      this.client = client;
    }

    async reply(message, text) {
      return message.reply(text)
        .then(console.log("リプライ送信: " + text))
    }

    async msg(channelId, text, option={}) {
      return this.client.channels.get(channelId).send(text, option)
        .then(console.log("メッセージ送信: " + text + JSON.stringify(option)))
    }
}

module.exports = Speech