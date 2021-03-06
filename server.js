const http = require('http');
const querystring = require('querystring');
const discord = require('discord.js');
const client = new discord.Client();
const config = require("./config.json")
const command = require("./lib/command.js")
const speech = new (require('./lib/speech.js'))(client)
const ytdl = require("ytdl-core")
const music = new (require('./lib/music.js'))()
const twitterPipeline = new (require('./lib/twitter-pipeline.js'))(client, error_handler=errorHandler)
const reminder = new (require("./lib/reminder"))(client, error_handler=errorHandler)
const cronCheck = require('cron-validator');


http.createServer(function(req, res){
  if (req.method == 'POST'){
    var data = "";
    req.on('data', function(chunk){
      data += chunk;
    });
    req.on('end', function(){
      if(!data){
        res.end("No post data");
        return;
      }
      var dataObject = querystring.parse(data);
      console.log("post:" + dataObject.type);
      if(dataObject.type == "wake"){
        console.log("Woke up in post");
        res.end();
        return;
      }
      res.end();
    });
  }
  else if (req.method == 'GET'){
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Discord Bot is active now\n');
  }
}).listen(3000);

for(const env of config.require_envs)
  if(!process.env[env]) throw `Env not found: ${env}.`

client.on('ready', async message =>{
  console.log('Bot準備完了～');
  client.user.setPresence({ game: { name: 'げーむ' } });
  reminder.syncDB()
  twitterPipeline.syncDB()
});

client.on('message', async message =>{
  if (message.author.id == client.user.id || message.author.bot){
    return;
  }
  if (message.content.match(/にゃ～ん|にゃーん/)){
    let text = "にゃ～ん";
    speech.msg(message.channel.id, text);
    return;
  }

  // 音楽再生
  command.ifStartWith(message.content, config.command_prefix.play_music_start, async args => {
    if(args.length < 1) throw "Invalid args."

    // 発言者の参加チャンネルへ移動
    const channel = message.member.voiceChannel;
    const current_connection = client.voice.connections.get(process.env.DISCORD_GUILD_ID);
    const should_move = !current_connection || current_connection.channel.id !== channel.id;
    const conn = should_move ? await channel.join() : current_connection;

    await music.play(conn, args[0])
  }).catch(err => { errorHandler(message.channel.id, err) })

  // 音楽再生(ループ)
  command.ifStartWith(message.content, config.command_prefix.play_music_loop_start, async args => {
    if(args.length < 1) throw "Invalid args."

    // 発言者の参加チャンネルへ移動
    const channel = message.member.voiceChannel;
    const current_connection = client.voice.connections.get(process.env.DISCORD_GUILD_ID);
    const should_move = !current_connection || current_connection.channel.id !== channel.id;
    const conn = should_move ? await channel.join() : current_connection;

    await music.play(conn, args[0], option={loop: true})
  }).catch(err => { errorHandler(message.channel.id, err) })

  // 音楽停止
  command.ifStartWith(message.content, config.command_prefix.play_music_end, async args => {
    await music.stop()
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダー登録
  command.ifStartWith(message.content, config.command_prefix.reminder_create, async args => {
    if(args.length <= 5) throw "Invalid args."

    const cron = args.slice(0, 5).join(" ")
    const text = args.slice(5).join(" ").replace(/\\n/g, "\n")
    const is_valid_cron = await cronCheck.isValidCron(cron, {alias: true})

    if(is_valid_cron){
        await reminder.add(message.channel.id, cron, text, message.author.id)
        await speech.reply(message, config.messages.reminder_create_success)
    } else throw "Invalid cron syntax."
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダー取得
  command.ifStartWith(message.content, config.command_prefix.reminder_get, async args => {
    await speech.msg(message.channel.id, config.messages.reminder_get_result)
    const reminders = await reminder.get()

    return (reminders.forEach(reminder => {
      // 通知を飛ばさないようメンションは無効化
      const text = reminder.text.replace(/@/g, "")
      const channel = client.channels.get(reminder.channel_id)
      const author = client.users.get(reminder.author_id)

      speech.embedMsg(message.channel.id, {
          color: config.color.reminder,
          description: text,
          author: {
              name: author.username,
              icon_url: author.avatarURL
          },
          footer: {
              text: `ID: ${reminder._id}\nCron: ${reminder.cron}\nChannel: #${channel.name}`
          }
      })
    }))
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダー削除
  command.ifStartWith(message.content, config.command_prefix.reminder_delete, async args => {
    const id = args[0]
    const deleted_count = await reminder.delete(id)
    return speech.reply(message, deleted_count >= 1 ? config.messages.reminder_delete_success : config.messages.reject)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // リマインダークーロン登録
  command.ifStartWith(message.content, config.command_prefix.reminder_set_cron, async args => {
    if(args.length <= 4) throw "Invalid args."
    else if(reminder.remind_content_registry == null) throw "Insufficient remind message"
    else if (!(await cronCheck.isValidCron(args.join(" ")), {alias: true})) throw "Invalid cron syntax."
    else {
      const cron = args.join(" ")
      const channel_id = reminder.remind_content_registry.channel_id
      const text = reminder.remind_content_registry.text
      const author_id = reminder.remind_content_registry.author_id

      await reminder.add(channel_id, cron, text, author_id)
      await speech.reply(message, config.messages.reminder_create_success)
      
      reminder.remind_content_registry = null
    }
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン作成
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_create, async args => {
    if(args.length <= 0) throw "Invalid args."

    let track_content
    let track_type

    //ユーザ監視パイプラインの場合
    if(args[0][0] === "@") {
        const twitter_user_screen_name = args[0].replace("@", "")
        const twitter_user = await twitterPipeline.getUserFromScreenName(twitter_user_screen_name)
        track_content = twitter_user.id_str
        track_type = "user"
    }else{
        track_content = args[0]
        track_type = "word"
    }

    await twitterPipeline.add(message.channel.id, track_content, track_type)
    await speech.msg(message.channel.id, config.messages.twitter_pipeline_create_success)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン取得
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_get, async args => {
    const userNameChannelIdMap = await twitterPipeline.getUserNameChannelIdMap()
    let pipeline_fields = []

    Object.keys(userNameChannelIdMap).forEach(user_id => {
      pipeline_fields.push({
        name: `@${userNameChannelIdMap[user_id].screen_name}`,
        value: `
          to <#${userNameChannelIdMap[user_id].channel_id}>
        `
      })
    })

    Object.keys(twitterPipeline.word_channel_id_map).forEach(word => {
      pipeline_fields.push({
        name: `${word}`,
        value: `
          to <#${twitterPipeline.word_channel_id_map[word]}>
        `
      })
    })

    speech.embedMsg(message.channel.id, {
      color: config.color.twitter,
      fields: pipeline_fields
    })
  }).catch(err => { errorHandler(message.channel.id, err) })

  // Twitterパイプライン削除
  command.ifStartWith(message.content, config.command_prefix.twitter_pipeline_delete, async args => {
    if(args.length <= 0) throw "Invalid args."

    let track_content

    if(args[0][0] == "@") {
        const twitter_user_screen_name = args[0].replace("@", "")
        const twitter_user = await twitterPipeline.getUserFromScreenName(twitter_user_screen_name)
        track_content = twitter_user.id_str
    }else{
        track_content = args[0]
    }

    await twitterPipeline.delete(track_content)
    await speech.msg(message.channel.id, config.messages.twitter_pipeline_delete_success)
  }).catch(err => { errorHandler(message.channel.id, err) })

  // ヘルプ
  command.ifStartWith(message.content, config.command_prefix.help, async args => {
    return speech.embedMsg(message.channel.id, {
        color: config.color.safe,
        description: config.messages.help.join("\n")
    })
  }).catch(err => { errorHandler(message.channel.id, err) })

  // ミュートの人の発言
  if(message.member.selfMute) {
    try{
      const channel = message.member.voiceChannel;
      console.log(channel)
      const text = message
          .content
          .replace(/https?:\/\/\S+/g, '')
          .replace(/<a?:.*?:\d+>/g, '') // カスタム絵文字を除去
          .slice(0, config.text_to_speech_length_limit);

      if(!text) return 
      if(channel.members.array().length < 1) return

      // 発言者の参加チャンネルへ移動
      const current_connection = client.voice.connections.get(process.env.DISCORD_GUILD_ID);
      const should_move = !current_connection || current_connection.channel.id !== channel.id;
      const conn = should_move ? await channel.join() : current_connection;

      conn.playStream(await speech.textToAudioStream(text), {highWaterMark: 6, bitrate: 'auto'});
    }catch(err) {
      errorHandler(message.channel.id, err)
    }
  }
})

// voiceチャンネルに一人だけになったら抜ける
client.on('voiceStateUpdate', (oldState, newState) => {
  const conn = client.voice.connections.get(process.env.DISCORD_GUILD_ID);
  if(conn && conn.channel && conn.channel.members.array().length < 2) {
    conn.disconnect();
  }
})

// 特定のリアクションが付いたら
client.on('messageReactionAdd', reaction => {

  switch(reaction._emoji.name) {
    case config.reaction.reminder:
      // メッセージの内容をレジストリに登録
      reminder.remind_content_registry = {
          channel_id: reaction.message.channel.id,
          text: reaction.message.content,
          author_id: reaction.message.author.id
      }
      speech.msg(reaction.message.channel.id, config.messages.reminder_require_cron)
      break

  }
})

if(process.env.DISCORD_BOT_TOKEN == undefined){
 console.log('DISCORD_BOT_TOKENが設定されていません。');
 process.exit(0);
}

if(process.env.TWITTER_CONSUMER_KEY == undefined
    || process.env.TWITTER_CONSUMER_SECRET == undefined
    || process.env.TWITTER_ACCESS_TOKEN_KEY == undefined
    || process.env.TWITTER_ACCESS_TOKEN_SECRET == undefined
  ) {
  console.log('TWITTER_TOKENが設定されていません。');
  process.exit(0);
}

function errorHandler(channel_id, err) {
  console.error(err)

  switch(err) {
    case "Invalid args.":
      speech.msg(channel_id, config.messages.invalid_arg)
        .catch(e => {console.error(e)})
      break
    case "Invalid cron syntax.":
      speech.msg(channel_id, config.messages.invalid_cron_syntax)
        .catch(e => {console.error(e)})
      break
    case "Insufficient remind message":
      speech.msg(channel_id, config.messages.reminder_require_content)
        .catch(e => {console.error(e)})
      break
    case "Invalid youtube url.":
      speech.msg(channel_id, config.messages.play_music_invalid_youtube_url)
        .catch(e => {console.error(e)})
      break
    default:
      speech.embedMsg(channel_id, {
          color: config.color.danger,
          description: JSON.stringify(err)
      }).catch(e => {console.error(e)})
  }
}

client.login( process.env.DISCORD_BOT_TOKEN );