const Datastore = require('nedb');

module.exports = {
    load: datafile_path => {
        return new Datastore({ filename: datafile_path, autoload: true });
    }
}