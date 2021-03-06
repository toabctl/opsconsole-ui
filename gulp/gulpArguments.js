// (c) Copyright 2016-2017 Hewlett Packard Enterprise Development LP
// (c) Copyright 2017 SUSE LLC
var minimist = require('minimist');

var argumentOptions = {
    string: 'env',
    boolean: 'coverage',
    default: {
        env: null,
        coverage: true
    }
};
var validEnvs = [null, 'hos', 'cs'];

var args = minimist(process.argv.slice(2), argumentOptions);

if (validEnvs.indexOf(args.env) == -1) {
    console.log('The env option must be either hos or cs');
    process.exit(1);
}

module.exports = args;
