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

    // embed機能はsend時にoption指定すると動かないので、msgとメソッド分割
    async embedMsg(channelId, embed) {
      return this.client.channels.get(channelId).send({embed: embed})
        .then(console.log("埋め込みメッセージ送信: " + embed.title))
    }
}

module.exports = Speech