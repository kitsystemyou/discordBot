module.exports = {
  reply: (message, text) => {
    message.reply(text)
      .then(console.log("リプライ送信: " + text))
      .catch(console.error);
  },

  msg: (channelId, text, option={}) => {
    client.channels.get(channelId).send(text, option)
      .then(console.log("メッセージ送信: " + text + JSON.stringify(option)))
      .catch(console.error);
  }
}