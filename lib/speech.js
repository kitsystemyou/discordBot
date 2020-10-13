const textToSpeech = require('@google-cloud/text-to-speech');
const { Readable } = require('stream');
const config = require('../config.json')

class Speech {
    constructor(discord_client) {
      this.discord_client = discord_client;
      this.text_to_speech_client = new textToSpeech.TextToSpeechClient({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        }
      })
    }

    async reply(message, text) {
      return message.reply(text)
        .then(console.log("リプライ送信: " + text))
    }

    async msg(channelId, text, option={}) {
      return this.discord_client.channels.get(channelId).send(text, option)
        .then(console.log("メッセージ送信: " + text + JSON.stringify(option)))
    }

    // embed機能はsend時にoption指定すると動かないので、msgとメソッド分割
    async embedMsg(channelId, embed) {
      return this.discord_client.channels.get(channelId).send({embed: embed})
        .then(console.log("埋め込みメッセージ送信: " + JSON.stringify(embed)))
    }

    async textToAudioStream(text, audioConfig={
          audioEncoding: 'OGG_OPUS',
          speakingRate: 1.2
    }, voiceConfig = {
          languageCode: 'ja-JP',
          name: 'ja-JP-Wavenet-A'
    }) {
      const request = {
        input: {text},
        voice: voiceConfig,
        audioConfig: audioConfig
      };

      const [response] = await this.text_to_speech_client.synthesizeSpeech(request);
      const stream = new Readable({ read() {} });
      stream.push(response.audioContent);

      return stream;
    }
}

module.exports = Speech