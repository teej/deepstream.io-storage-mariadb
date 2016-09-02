'use strict'

const events = require('events');
const util = require('util');
const pckg = require('../package.json');
const defaults = require('../defaults.js');

const sql = require('mariasql');
const uuid = require('node-uuid');

class Connector extends events.EventEmitter {
	constructor (options) {
		if (! (typeof options === 'object')) throw new TypeError('Incorrect connection options passed');
		super();
		this.isReady = false;
		this.name = pckg.name;
		this.version = pckg.version;
		options = Object.assign({}, defaults, options);
		if (process.env.ds_host) options.mariasql.host = process.env.ds_host;
		if (process.env.ds_user) options.mariasql.user = process.env.ds_user;
		if (process.env.ds_password) options.mariasql.password = process.env.ds_password;
		if (process.env.ds_databaseName) options.mariasql.db = process.env.ds_databaseName;
		if (process.env.ds_tableName) options.table.name = process.env.ds_tableName;
		if (process.env.ds_keyType) options.table.keyType = process.env.ds_keyType;
		if (process.env.ds_valueType) options.table.valueType = process.env.ds_valueType;
		if (process.env.ds_splitter) options.splitter = process.env.ds_splitter;
		this._db = new sql(options.mariasql);
		this._db.on('ready', () => {
			this._table = options.table;
			this._splitter = options.splitter;
			this._tableList = [];
			this._db.query(
				('create table if not exists ' + options.table.name +
				' (pk bigint auto_increment primary key, ds_key ' + options.table.keyType +
				', ds_value ' + options.table.valueType +
				', key ds_key (ds_key(32))) engine=InnoDB default charset utf8;'),
				(e, rows) => {
					if (e) return this.emit('error', e);
					this._db.query('show tables', (e2, rows2) => {
						if (e2) return this.emit('error', e2);
						rows2.forEach((x, i, ar) => {
							this._tableList.push(x.Tables_in_deepstream);
						});
					});
				}
			);
			this.isReady = true;
			this.emit('ready');
		});
		this._db.on('error', (e) => {
			this.emit('error', e);
		});
		this._db.end();
		this._db.connect();
	}

	_upsert (tableName, key, value) {
		return new Promise((go, stop) => {
			this._db.query('select * from ' + tableName + ' where ds_key = ?', [ key ], (e, rows) => {
				if (e) return stop(e);
				if (rows[0]) this._db.query('update ' + tableName + ' set ds_value = ? where ds_key = ?', [ value, key ], (e2, rows2) => {
					if (e2) return stop(e2);
					return go();
				})
				if (! rows[0]) this._db.query('insert into ' + tableName + ' (ds_key, ds_value) values (?, ?)', [ key, JSON.stringify(value) ], (e2, rows2) => {
					if (e2) return stop(e2);
					return go();
				});
			});
		});
	}

	set (key, value, callback) {
		var splitted = undefined;
		try {
			 splitted = key.split(this._splitter);
		} catch (e) {
			return callback(e);
		};
		let tableName = (splitted.length > 1) ? splitted[0] : this._table.name;
		if (this._tableList.indexOf(tableName) > -1) {
			this._upsert(tableName, key, value).then(() => {
				return callback(null);
			}).catch((e) => {
				return callback(e);
			});
		} else {
			this._db.query(
				('create table if not exists ' + tableName +
				' (pk bigint auto_increment primary key, ds_key ' + this._table.keyType +
				', ds_value ' + this._table.valueType +
				', key ds_key (ds_key(32))) engine=InnoDB default charset utf8;'),
				(e, rows) => {
					if (e) return this.emit('error', e);
					this._upsert(tableName, key, value).then(() => {
						return callback(null);
					}).catch((e) => {
						return callback(e);
					});
				}
			);
		};

	}

	get (key, callback) {
		var splitted = undefined;
		try {
			 splitted = key.split(this._splitter);
		} catch (e) {
			return callback(e);
		};
		let tableName = (splitted.length > 1) ? splitted[0] : this._table.name;
		this._db.query('select * from ' + tableName + ' where ds_key = ?', [ key ], (e, rows) => {
			if (e) return callback(e);
			let result = undefined;
			try {
				result = rows[0].ds_value;
			} catch (e) {
				result = null;
			};
			try {
				let deserialized = JSON.parse(result);
				return callback(null, deserialized);
			} catch (e) {
				return callback(null, result);
			};
		});
	}

	delete (key, callback) {
		var splitted = undefined;
		try {
			 splitted = key.split(this._splitter);
		} catch (e) {
			return callback(e);
		};
		let tableName = (splitted.length > 1) ? splitted[0] : this._table.name;
		this._db.query('delete from ' + tableName + ' where ds_key = ?', [ key ], (e, rows) => {
			if (e) callback(e);
			return callback(null);
		});
	}
}

module.exports = Connector