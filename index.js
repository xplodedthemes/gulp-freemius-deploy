/**
 * Deploy to Freemius.
 *
 * @param gulp
 * @param dirname
 * @param args
 */

/* The `args` options

{
  "developer_id": 000,
  "plugin_id": 000,
  "plugin_slug": "plugin-slug",
  "zip_name": "premium-version-zip-name.zip",
  "zip_name_free": "free-version-zip-name.zip",
  "add_contributor": false,
  "auto_release": true,
  "svn_path": "/path/to/svn",
  "envato": {
    "modify": {
        "find": "##MARKET##",
        "replace": "envato"
    },
  },
  "ftps": [
    {
      "host":     "ftp-host.com",
      "username": "username",
      "password": "password",
      "port":	  "21",
      "secure":	  false,
      "path":     "./"
    }
  ],
  "rsync": {
    "host":     "ip-host",
    "username": "username",
    "path":     "path/to/plugins"
  }
}

*/

module.exports = function( gulp, dirname, args ) {

    /**
     * Deps.
     */

    const notifier = require( 'node-notifier' ),
        os = require('os'),
        fs = require( 'fs' ),
        path = require('path'),
        extract = require('extract-zip'),
        replace = require('gulp-replace'),
        zip = require('gulp-zip'),
        clean = require('gulp-clean'),
        needle = require( 'needle' ),
        request = require( 'request' ),
        httpBuildQuery = require('http-build-query'),
        cryptojs = require( 'crypto-js' ),
        exec = require("sync-exec"),
        ftp = require( 'vinyl-ftp' ),
        sftpClient = require('ssh2-sftp-client'),
        sftp = new sftpClient(),
        rsync = require('gulp-rsync');

    const FS_API_ENPOINT = 'https://api.freemius.com';
    var AUTH = '';

    const SRC_PATH = path.resolve(dirname, 'src');
    const DIST_PATH = path.resolve(dirname, 'dist');

    var previous_versions = [];
    var previous_version;
    var deployed_version;
    var update_mode = false;
    

    /**
     * Base 64 URL encode.
     *
     * @param str
     * @return string
     */
    var base64_url_encode = function( str ) {
        str = new Buffer( str ).toString( 'base64' );
        // str = strtr(base64_encode($input), '+/', '-_');
        str = str.replace( /=/g, '' );

        return str;
    };


    var runExec = function(command) {

        console.log(command);

        let response = exec(command);
        if(response.stderr) throw response.stderr;

        console.log(response.stdout);
    };

    var showStep = function(title) {

        console.log('\x1b[34m%s\x1b[0m', '\r\n' + title+'...' + '\r\n');
    };

    var showSuccess = function(msg, notify = false) {

        if(notify) {
            notifier.notify({message: msg});
        }
        console.log('\x1b[32m%s\x1b[0m', '\r\n' + msg + '\r\n');
    };

    var showError = function(error, notify = false) {

        if(notify) {
            notifier.notify({message: error});
        }
        console.log('\x1b[31m%s\x1b[0m', '\r\n' + error + '\r\n');
    };

    var res_url = function (path, params = null) {

        if (params) {
            params = '?' + params;
        }

        return FS_API_ENPOINT + '/v1/developers/' + args.developer_id + '/plugins/' + args.plugin_id + '/' + path + params;
    }

    var find_object_by_key = function (array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }


    gulp.task('clear', function (cb) {

        runExec('clear');
        cb();
    });

    gulp.task('freemius-auth', function(cb) {

		var options = {
			action:'XT_FREEMIUS_GET_TOKEN',
			XT_FREEMIUS_DEV_ID: process.env.FREEMIUS_DEV_ID,
			XT_FREEMIUS_PUBLIC_KEY: process.env.FREEMIUS_PUBLIC_KEY,
			XT_FREEMIUS_PRIVATE_KEY: process.env.FREEMIUS_PRIVATE_KEY,
			XT_FREEMIUS_EMAIL: process.env.FREEMIUS_EMAIL,
			XT_FREEMIUS_PASSWORD: process.env.FREEMIUS_PASSWORD,
		};

		needle('post', 'https://xplodedthemes.com', options).then(function (response) {

            var token = response.body.token;

            AUTH = 'FSA ' + args.developer_id + ':' + token;

            cb();
        })
        .catch(function (error) {
            showError('Error fetching Freemius access token.');
            showError(error);
            cb();
            return;
        });

    });

    gulp.task('clean', function (cb) {

        showStep('Cleanup');

        if(fs.existsSync('src') || fs.existsSync('dist')) {
            return gulp.src(['src', 'dist'], {read: false})
                .pipe(clean())
                .on('end', cb);
        }else{
            cb();
        }
    });

    gulp.task('structure', (cb) => {

        showStep('Create Folder Structure');

        const folders = [
            'src',
            'dist'
        ];

        folders.forEach(dir => {
            if(!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                console.log('Folder created:', dir);
            }
        });

        cb();
    });

    gulp.task('prepare', function (cb) {
	    
	    showStep('Zip & Clean Source');
	    
        gulp.src([
            '../**',
            '!../node_modules/**',
            '!../gulpfile*',
            '!**'
        ])
        .pipe(zip('deploy.zip'))
        .pipe(gulp.dest('src'))
        .on('end', function() {
            
            runExec('cd src && zip -d deploy.zip "*.DS_Store" "*__MACOSX*"');
            cb();
        });
    });

    gulp.task('freemius-check-version', function(cb) {

        var options = {
            headers: {
                "Authorization": AUTH
            }
        };

        needle('get', res_url('tags.json', 'count=50'), options).then(function (response) {

            var tags = response.body.tags;

            if(tags && tags.length > 0) {
                previous_versions = tags.slice();
                previous_version = tags.shift().version;
            }

            cb();
        })
        .catch(function (error) {
            showError('Error checking Freemius latest version.');
            showError(error);
            cb();
            return;
        });
    });

    gulp.task( 'freemius-deploy', function (cb) {

        if (!Number.isInteger(args.plugin_id)) {
            return;
        }

        var buffer = fs.readFileSync(SRC_PATH + '/deploy.zip'),
            data = {
                add_contributor: args.add_contributor,
                file: {
                    buffer: buffer,
                    filename: 'deploy.zip',
                    content_type: 'application/zip'
                }
            },
            options = {
                multipart: true,
                headers: {
                    "Authorization": AUTH
                }
            };


        // Deploy to Freemius
        showStep('Deploying to Freemius');

        needle('post', res_url('tags.json'), data, options).then(function (response) {

            var body = response.body;
            var message;
            var tag_id;

            if (typeof body !== 'object') {
                showError('Something Went Wrong!');
                cb();
                return;
            }

            if (typeof body.error !== 'undefined') {
                message = 'Error: ' + body.error.message;
                showError(message);
                cb();
                return;
            }

            tag_id = body.id;

            message = 'Successfully deployed v' + body.version + ' to Freemius.';
            showSuccess(message, true);

            // Save plugin version
            deployed_version = body.version;

            // Set update mode
            var version_exists = find_object_by_key(previous_versions, 'version', deployed_version)

            update_mode = version_exists ? true : false;

            var force = typeof(process.argv[3]) !== 'undefined' && process.argv[3] === '--force';
            if(force) {
                update_mode = false;
            }

            if(update_mode) {
                showStep('Running update mode...');
            }

            // Auto Release Version
            if(args.auto_release) {

                showStep('Auto releasing version on Freemius');

                var data = {
                        release_mode: 'released'
                    },
                    options = {
                        headers: {
                            "Authorization": AUTH
                        }
                    };

                needle('put', res_url('tags/' + tag_id + '.json', 'fields=id,release_mode,version'), data, options).then(function (response) {

                    var body = response.body;

                    if (typeof body !== 'object') {
                        showError('Something Went Wrong!');
                        cb();
                        return;
                    }

                    if (typeof body.error !== 'undefined' || body.release_mode !== 'released') {
                        message = 'Error: ' + body.error.message;
                        showError(message);
                        cb();
                        return;
                    }

                    showSuccess('Successfully released v' + body.version + ' on Freemius', true);
                })
                .catch(function (error) {
                    showError('Error releasing version on Freemius.');
                    cb();
                    return;
                });

            }


            // Download Premium Version
            showStep('Downloading premium version from freemius');

            var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                authorization: AUTH,
                beautify: true,
                is_premium: true,
            }));

            request(download_url)
                .pipe(fs.createWriteStream(DIST_PATH + '/' + args.zip_name))
                .on('error', (error) => {
                    showError(error);
                    cb();
                    return;
                })
                .on('close', function () {
                    message = "The premium version was downloaded to " + DIST_PATH + '/' + args.zip_name;
                    showSuccess(message, true);


                    // Download Free Version
                    showStep('Downloading free version from freemius');

                    var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                        authorization: AUTH,
                        beautify: true,
                        is_premium: false,
                    }));

                    request(download_url)
                        .pipe(fs.createWriteStream(DIST_PATH + '/' + args.zip_name_free))
                        .on('error', (error) => {
                            showError(error);
                            cb();
                            return;
                        })
                        .on('close', function () {
                            message = "The free version was downloaded to " + DIST_PATH + '/' + args.zip_name_free;
                            showSuccess(message, true);


                            if(update_mode) {
                                showStep('Version update completed!');
                                process.stdin.pause();
                                cb();
                                process.exit(0);
                            }

                            cb();
                            return;
                        });

                });

        })
        .catch(function (error) {
            showError('Error deploying to Freemius.');
            showError(error);
            cb();
            return;
        });

    });


    gulp.task('wordpress-deploy', function (cb) {

        if(!deployed_version || !args.auto_release){
            cb();
            return;
        }

        showStep('Deploying free version to WordPress SVN');

        let svn_path = os.homedir() + args.svn_path + '/';
        let svn_trunk_path = svn_path + 'trunk/';
        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'free/';

        console.log('svn_path', svn_path);
        console.log('svn_trunk_path', svn_trunk_path);

        extract(zip_path + args.zip_name_free, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err

            if(err) throw err;

            runExec('cd '+svn_trunk_path+' && rm -rf *');
            runExec('cd '+extracted_path+'*/ && cp -R ./* '+svn_trunk_path);
            runExec('cd '+svn_path+' && svn upgrade');
            runExec('cd '+svn_path+' && svn status | grep \'^!\' | awk \'{print $2}\' | xargs svn delete');
            runExec('cd '+svn_path+' && svn add --force .');
            runExec('cd '+svn_path+' && svn commit -m "Update"');

            cb();

        });

    });

    gulp.task('envato-prepare', function (cb) {

        if(!deployed_version || !args.auto_release) {
            cb();
            return;
        }

        showStep('Creating premium version for Envato');

        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'envato/';

        extract(zip_path + args.zip_name, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err

            if (err) throw err;

            var cleanEnvatoFolder = function(cb) {

                runExec('cd "' + extracted_path + '" && find . -not -name "*.zip" -delete');
                runExec('cd "' +extracted_path + '" && zip -d *.zip "*.DS_Store" "*__MACOSX*"');
                cb();
            };

            var zipEnvatoVersion = function(cb) {

                gulp.src(extracted_path + '*/**')
                    .pipe(zip(args.zip_name))
                    .pipe(gulp.dest(extracted_path))
                    .on('end', function() {
	                    
                        cleanEnvatoFolder(cb)
                    });

            };

            if(typeof(args.envato.modify) !== 'undefined') {

                gulp.src([extracted_path + '*/*.php', extracted_path + '*/**/*.php'])
                    .pipe(replace(args.envato.modify.find, args.envato.modify.replace))
                    .pipe(replace(/\/\*.ENVATO_EXCLUDE_BEGIN.\*\/([\s\S]+?)\/\*.ENVATO_EXCLUDE_END.\*\//g, ''))
                    .pipe(gulp.dest(extracted_path))
                    .on('end', function() {

                        showStep('Remove freemius related files from the Envato Version');

                        runExec('cd '+extracted_path + '*/includes/ && rm -rf freemius/ freemius-migration/');

                        zipEnvatoVersion(cb);
                    });

            }else{

                zipEnvatoVersion(cb);
            }

        });
    });


    gulp.task('ftp-deploy', function (cb) {

        if(!deployed_version || !args.auto_release) {
            cb();
            return;
        }

        if(typeof(args.ftps) !== 'undefined' && args.ftps.length) {

            showStep('FTP deployments');

            let zip_path = DIST_PATH + '/';
            let extracted_path = zip_path + 'envato/';

            let total = args.ftps.length;
            let i = 0;

            args.ftps.forEach(function (params) {

                showStep('Deploying to ' + params.host);

                if(params.port === 21) {

                    var conn = ftp.create({
                        host: params.host,
                        user: params.username,
                        pass: params.password,
                        port: params.port,
                        secure: params.secure
                    });

                    // using base = '.' will transfer everything to /public_html correctly
                    // turn off buffering in gulp.src for best performance

                    return gulp.src(extracted_path + args.zip_name, {base: './dist/envato', buffer: false})
                        .pipe(conn.newer(params.path)) // only upload newer files
                        .pipe(conn.dest(params.path))
                        .on('end', function() {
                            showSuccess('Successfully deployed to ' + params.host);
                            i++;
                            if(i === total) {
                                cb();
                            }
                        });

                }else{
					
					var private_key_path = path.join(os.homedir(), '/.ssh/id_rsa');
					
					var connection = {
						host: params.host,
                        	pass: typeof(params.password) !== 'undefined' ? params.password : null,
						port: params.port,
						username: params.username,
						privateKey: typeof(params.password) !== 'undefined' ? null : fs.readFileSync(private_key_path)
					};
                    
                    sftp.connect(connection).then(() => {

                        return sftp.fastPut(extracted_path + args.zip_name, params.path + '/' + args.zip_name);

                    }).then((data) => {
                        showSuccess('Successfully deployed to ' + params.host);
                        i++;
                        if(i === total) {
                            cb();
                        }

                    }).catch((err) => {
                        console.log(err);
                        showError('Failed deploying to ' + params.host);
                        i++;
                        if(i === total) {
                            cb();
                        }
                    });

                }
            });

        }else{
            cb();
        }

    });

    gulp.task('demo-deploy', function (cb) {

        if(!deployed_version || !args.auto_release || !args.rsync){
            cb();
            return;
        }

        showStep('Deploying premium version to demo site');

        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'premium/';
        let plugin_folder_name = path.basename(extracted_path+args.zip_name, '.zip');
        let extracted_plugin_path = extracted_path + plugin_folder_name;

        extract(zip_path + args.zip_name, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err
            if(err) throw err;

            console.log(extracted_plugin_path);

            runExec('cd '+extracted_plugin_path + '*/ && rsync -avz --delete --recursive ./ '+args.rsync.username+'@'+args.rsync.host+':'+args.rsync.path + '/' + plugin_folder_name);

            showSuccess('Successfully deployed to ' + args.rsync.username+'@'+args.rsync.host);
            cb();

        });

    });

    gulp.task('git-deploy', function (cb) {

		if(!deployed_version || !args.auto_release) {
		    cb();
		    return;
		}
		
		showStep('Push and tag version on GIT');
		
		runExec('cd .. && git add .');
		runExec('cd .. && git commit -a -m "Update"');
		runExec('cd .. && git pull origin');
		runExec('cd .. && git submodule update --recursive --remote --merge');
		runExec('cd .. && git submodule foreach --recursive git checkout -f master');
		runExec('cd .. && git add .');
		runExec('cd .. && git commit -a -m "Update Submodules"');
				
		if(previous_version !== deployed_version) {
		    runExec('cd .. && git tag -f ' + deployed_version);
		    runExec('cd .. && git push -f --tags');
		}
		
		runExec('cd .. && git push');

		showSuccess('Successfully deployed to git');
		
		cb();
    });

	gulp.task('flush-cache', function (cb) {
	
		if(typeof(args.plugin_slug) === 'undefined') {
			cb();
            	return;
		}
		
		needle('get', 'https://xplodedthemes.com/products/'+args.plugin_slug+'/?nocache=1')
		.then(function (response) {

	        showSuccess('Successfully flushed product page cache on XplodedThemes.com');
	        cb();
	    })
        .catch(function (error) {
            showError('Failed flushing plugin page cache on XplodedThemes.com');
            showError(error);
            cb();
            return;
        });
	});
	
	gulp.task('completed', function (cb) {

        if(deployed_version) {

        	showSuccess('Successfully deployed '+args.zip_name);
        	
		}else{
			
			showError('Failed deploying '+args.zip_name);
		}
		
        cb();
    });

    let deploy_tasks = [
        'clear',
        'freemius-auth',
        'clean',
        'structure',
        'prepare',
        'freemius-check-version',
        'freemius-deploy'
    ];

    if(!update_mode) {

        if (typeof(args.svn_path) !== 'undefined' && args.svn_path !== false) {

            deploy_tasks.push('wordpress-deploy');
        }

        if (typeof(args.envato) !== 'undefined' && args.envato !== false) {

            deploy_tasks.push('envato-prepare');
        }
        
        if (typeof(args.ftps) !== 'undefined' && args.ftps.length) {

            deploy_tasks.push('ftp-deploy');
        }

        deploy_tasks.push('demo-deploy');
        deploy_tasks.push('git-deploy');
    }

	deploy_tasks.push('flush-cache');
    	deploy_tasks.push('completed');

    gulp.task('deploy', gulp.series(deploy_tasks));

};
