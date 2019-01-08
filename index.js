/**
 * Deploy to Freemius.
 *
 * The `args` param should contain values for developer_id, plugin_id, secret_key, public_key, zip_name, zip_path, add_contributor.
 *
 * @param gulp
 * @param args
 */
module.exports = function( gulp, args ) {
    /**
     * Deps.
     */

    const FS_API_ENPOINT = 'https://api.freemius.com';
    const AUTH = 'FSA ' + args.developer_id + ':' + args.access_token;

    var notifier = require( 'node-notifier' ),
        zip = require('gulp-zip'),
        needle = require( 'needle' ),
        request = require( 'request' ),
        httpBuildQuery = require('http-build-query'),
        os = require('os'),
        fs = require( 'fs' ),
        path = require('path'),
        cryptojs = require( 'crypto-js' ),
        AdmZip = require('adm-zip');

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

    gulp.task( 'freemius-deploy', (done) => {

        if (!Number.isInteger(args.plugin_id)) {
            return;
        }

        var res_url = function (path, params = null) {

            if (params) {
                params = '?' + params;
            }

            return FS_API_ENPOINT + '/v1/developers/' + args.developer_id + '/plugins/' + args.plugin_id + '/' + path + params;
        }

        var buffer = fs.readFileSync(args.src_path + '/' + args.src_zip_name),
            data = {
                add_contributor: args.add_contributor,
                file: {
                    buffer: buffer,
                    filename: args.src_zip_name,
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

        needle('post', res_url('tags.json'), data, options).then(function (response) {

            var body = response.body;
            var message;
            var tag_id;

            if (typeof body !== 'object') {
                message = 'Something Went Wrong! ';
                notifier.notify({message: message});
                console.log('\x1b[31m%s\x1b[0m', message);
                done();
                return;
            }

            if (typeof body.error !== 'undefined') {
                message = 'Error: ' + body.error.message;
                notifier.notify({message: message});
                console.log('\x1b[31m%s\x1b[0m', message);
                done();
                return;
            }

            tag_id = body.id;

            message = 'Successfully deployed v' + body.version + ' to Freemius.';
            notifier.notify({message: message});
            console.log('\x1b[32m%s\x1b[0m', message);


            // Auto Release Version
            if(args.auto_release) {

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
                        message = 'Something Went Wrong! ';
                        notifier.notify({message: message});
                        console.log('\x1b[31m%s\x1b[0m', message);
                        done();
                        return;
                    }

                    if (typeof body.error !== 'undefined' || !body.is_released) {
                        message = 'Error: ' + body.error.message;
                        notifier.notify({message: message});
                        console.log('\x1b[31m%s\x1b[0m', message);
                        done();
                        return;
                    }

                    message = 'Successfully released v' + body.version + ' on Freemius';
                    notifier.notify({message: message});
                    console.log('\x1b[32m%s\x1b[0m', message);
                })
                .catch(function (error) {
                    message = 'Error releasing version on Freemius.';
                    notifier.notify({message: message});
                    console.log('\x1b[31m%s\x1b[0m', message);
                    console.log(error);
                });

            }


            // Download Premium Version

            var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                authorization: AUTH,
                beautify: true,
                is_premium: true,
            }));

            request(download_url)
                .pipe(fs.createWriteStream(args.dist_path + '/' + args.dist_zip_name))
                .on('error', (error) => {
                    console.log('\x1b[31m%s\x1b[0m', error);
                })
                .on('close', function () {
                    message = "The premium version was downloaded to " + args.dist_path + '/' + args.dist_zip_name;
                    notifier.notify({message: message});
                    console.log('\x1b[32m%s\x1b[0m', message);
                });


            // Download Free Version

            var download_url = res_url('tags/' + tag_id + '.zip', httpBuildQuery({
                authorization: AUTH,
                beautify: true,
                is_premium: false,
            }));

            request(download_url)
                .pipe(fs.createWriteStream(args.dist_path + '/' + args.dist_zip_name_free))
                .on('error', (error) => {
                    console.log('\x1b[31m%s\x1b[0m', error);
                })
                .on('close', function () {
                    message = "The free version was downloaded to " + args.dist_path + '/' + args.dist_zip_name_free;
                    notifier.notify({message: message});
                    console.log('\x1b[32m%s\x1b[0m', message);
                });

        })
        .catch(function (error) {
            message = 'Error deploying to Freemius.';
            notifier.notify({message: message});
            console.log('\x1b[31m%s\x1b[0m', message);
            console.log(error);
        });

        done();
    });

};
