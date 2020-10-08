module.exports = {
    ifStartWith: async (text, command_prefix, callback) => {

        // コマンドが指定のprefixで始まっていた場合、callback関数を実行
        if(text.startsWith(command_prefix)) {
            let args = text.replace(command_prefix, "").split(" ")
            args = args.filter(Boolean) // 空文字などを削除
            return callback(args)
        }else{
            return new Promise((resolve, reject)=>{})
        }
    }
}