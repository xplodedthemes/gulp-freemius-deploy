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
  "zip_name": "premium-version-zip-name.zip",
  "zip_name_free": "free-version-zip-name.zip",
  "add_contributor": false,
  "auto_release": true,
  "svn_path": "/path/to/svn",
  "envato_ftps": [
	{
      "host":     "ftp-host.com",
      "user":     "username",
      "password": "password",
      "path":     "/"
    }
  ]
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
        ftp = require( 'vinyl-ftp' );


    const FS_API_ENPOINT = 'https://api.freemius.com';
    const AUTH = 'FSA ' + args.developer_id + ':' + process.env.FS_ACCESS_TOKEN;

    const SRC_PATH = path.resolve(dirname, 'src');
    const DIST_PATH = path.resolve(dirname, 'dist');

    var deployed_version;

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

    gulp.task('clear', function (cb) {

        runExec('clear');
        cb();
    });

    gulp.task('npm-update', function (cb) {

        showStep('Fetch latest deployment script');

        runExec('git add .');
        runExec('git commit -a -m "Update"');
        runExec('git pull origin');
        runExec('git submodule update --recursive --remote');
        runExec('git push');

        showStep('NPM Update');
        runExec('npm update');

        cb();
    });

    gulp.task('clean', function (cb) {

        showStep('Cleanup');

        if(fs.existsSync('src') || fs.existsSync('dist')) {
            return gulp.src(['src', 'dist'], {read: false})
                .pipe(clean());
        }
        cb();
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

    gulp.task('prepare', () =>
        gulp.src([
            '../**',
            '!../node_modules/**',
            '!../gulpfile*',
            '!**'
        ])
            .pipe(zip('deploy.zip'))
            .pipe(gulp.dest('src'))
    );

    gulp.task( 'freemius-deploy', function (cb) {

        if (!Number.isInteger(args.plugin_id)) {
            return;
        }

        var res_url = function (path, params = null) {

            if (params) {
                params = '?' + params;
            }

            return FS_API_ENPOINT + '/v1/developers/' + args.developer_id + '/plugins/' + args.plugin_id + '/' + path + params;
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


            // Auto Release Version
            if(args.auto_release) {

                showStep('Auto releasing version on Freemius');

                var data = {
                        is_released: true
                    },
                    options = {
                        headers: {
                            "Authorization": AUTH
                        }
                    };

                needle('put', res_url('tags/' + tag_id + '.json', 'fields=id,is_released,version'), data, options).then(function (response) {

                    var body = response.body;

                    if (typeof body !== 'object') {
                        showError('Something Went Wrong!');
                        cb();
                        return;
                    }

                    if (typeof body.error !== 'undefined' || !body.is_released) {
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

        showStep('Creating premium version for Envato');

        let zip_path = DIST_PATH + '/';
        let extracted_path = zip_path + 'envato/';

        extract(zip_path + args.zip_name, {dir: extracted_path}, function (err) {
            // extraction is complete. make sure to handle the err

            if (err) throw err;

            gulp.src(extracted_path + '*/*.php')
                .pipe(replace('##XT_MARKET##', 'envato'))
                .pipe(gulp.dest(extracted_path));


            gulp.src(extracted_path + '*/**')
                .pipe(zip(args.zip_name))
                .pipe(gulp.dest(extracted_path));


            setTimeout(function () {

                runExec('cd "' + extracted_path + '" && find . -not -name "*.zip" -delete');
                cb();

            }, 5000);

        });
    });


    gulp.task('envato-deploy', function (cb) {

        args.envato_ftps.forEach(function(params) {

            var conn = ftp.create( {
                host:     params.host,
                user:     params.username,
                password: params.password,
                parallel: 10,
                log:      gutil.log
            });

            // using base = '.' will transfer everything to /public_html correctly
            // turn off buffering in gulp.src for best performance

            return gulp.src( extracted_path + '*.zip', { base: '.', buffer: false } )
                .pipe( conn.newer( params.path ) ) // only upload newer files
                .pipe( conn.dest( params.path ) );
        });

        cb();

    });


    gulp.task('git-deploy', function (cb) {

        showStep('Push and tag version on GIT');

        runExec('cd .. && git add .');
        runExec('cd .. && git commit -a -m "Update"');
        runExec('cd .. && git pull origin');
        runExec('cd .. && git submodule update --recursive --remote');
        runExec('cd .. && git tag -f '+deployed_version);
        runExec('cd .. && git push -f --tags');
        runExec('cd .. && git push');

        cb();
    });


    gulp.task('deploy', function(cb) {

        try{

            if(typeof(process.env.FS_ACCESS_TOKEN) === 'undefined') {

                throw 'Missing FS_ACCESS_TOKEN env variable. Please export your Freemius Access Token globaly as an env variable by inserting this within your .profile file.' + "\r\n" + 'export FS_ACCESS_TOKEN=<token>';
            }

        }catch(error) {

            showError(error, true);

            return cb();
        }

        gulp.series(
            'clear',
            'npm-update',
            'clean',
            'structure',
            'prepare',
            'freemius-deploy'
        )();

        if(deployed_version) {

            if (typeof(args.svn_path) !== 'undefined' && args.svn_path !== false) {

                gulp.series( 'wordpress-deploy')();
            }

            if (typeof(args.envato_ftps) !== 'undefined' && args.envato_ftps !== false) {

                gulp.series(
                    'envato-prepare',
                    'envato-deploy'
                )();
            }

            gulp.series('git-deploy')();
        }

        cb();
    });

};
