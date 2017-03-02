/**
 * A simple script to get OpenAQ data per day, convert to CSV and upload to S3.
 * Use with `all` argument (ex. node index.js all) to redo all dates
 */
'use strict';

import s3 from 's3';
import moment from 'moment';
import knexConfig from './knexfile';
import knex from 'knex';
import csv from 'csv-stringify';
import { unlinkSync, createWriteStream } from 'fs';
import { series } from 'async';
import through2 from 'through2';

// Create client, utilizing local env vars for AWS
const client = s3.createClient();
const db = knex(knexConfig);

// Get our initial start date for handling all data
const startDate = process.env.START_DATE || '2015-06-01';

// This is a top-level safety mechanism, we'll kill this process after a certain
// time in case it's hanging.
const processTimeout = process.env.PROCESS_TIMEOUT || 10 * 60 * 1000; // Kill the process after a certain time in case it hangs
setTimeout(() => {
  console.error('Uh oh, process timed out.');
  process.exit(1);
}, processTimeout);

/**
 * Upload the data to S3, credentials come from env vars
 *
 */
const uploadToS3 = function (file, done) {
  console.info(`Uploading ${file} to S3.`);

  const params = {
    localFile: file,
    s3Params: {
      Bucket: process.env.BUCKET_NAME || 'openaq-data',
      Key: file,
      ACL: 'public-read',
      ContentEncoding: 'text/csv'
    }
  };

  const uploader = client.uploadFile(params);

  uploader.on('error', (err) => {
    console.error('unable to upload:', err.stack);
    done(err);
  });

  uploader.on('progress', () => {
    const percent = parseInt((uploader.progressAmount / uploader.progressTotal) * 100);
    if (percent % 10 === 0) {
      console.info(`Upload percentage: ${percent}%`);
    }
  });

  uploader.on('end', () => {
    done(null);
  });
};

/**
 * Get all the data for the day from the database, convert to CSV and upload.
 *
 */
const getAndUploadData = function (date, cb) {
  let processed = 0;

  let yesterday = moment().utc().subtract(1, 'day');
  if (date) {
    yesterday = date.utc().subtract(1, 'day');
  }
  console.info(`Grabbing data for ${yesterday.format('YYYY-MM-DD')}`);

  // Stream from database
  let stream = db.select('data')
    .from('measurements')
    .whereBetween('date_utc', [yesterday.startOf('day').toISOString(), yesterday.endOf('day').toISOString()])
    .stream({timeout: 0});
  stream.on('error', (err) => {
    return cb(err);
  });

  // Transform stream to clean up data before CSV generation
  const transform = (chunk, enc, cb) => {
    const data = Object.assign({}, chunk.data);

    // Handle date
    data.utc = data.date.utc;
    data.local = data.date.local;
    delete data.date;

    // Handle coords
    if (data.coordinates) {
      data.latitude = data.coordinates.latitude;
      data.longitude = data.coordinates.longitude;
      delete data.coordinates;
    }

    // Print out a counter
    processed++;
    if (processed % 10000 === 0) {
      console.info(`Processed ${processed} records.`);
    }
    cb(null, data);
  };

  // CSV stringifier
  const options = {
    header: true,
    columns: ['location', 'city', 'country', 'utc', 'local', 'parameter', 'value', 'unit', 'latitude', 'longitude', 'attribution']
  };
  let stringifier = csv(options);
  stringifier.on('error', (err) => {
    return cb(err);
  });

  // Create writeable file for output
  const file = `${yesterday.format('YYYY-MM-DD')}.csv`;
  var wstream = createWriteStream(file);
  wstream.on('finish', function () {
    console.log(`File ${file} has been saved to disk.`);

    // Upload to S3
    uploadToS3(file, (err) => {
      // Remove generated file to be kind
      unlinkSync(file);

      if (err) {
        console.error(err);
        return cb(err);
      }

      // All done!
      console.info(`New file uploaded to S3: ${file}`);
      return cb();
    });
  });
  wstream.on('error', (err) => {
    return cb(err);
  });

  stream
  .pipe(through2({objectMode: true}, transform))
  .pipe(stringifier)
  .pipe(wstream);
};

// Check if we have `all` arg present and handle initial date accordingly
let date;
if (process.argv[2] === 'all') {
  console.info('Regenerating everything, hold on to your hats!');
  date = moment(startDate, 'YYYY-MM-DD');
} else {
  console.info('Generating data for last 2 days only.');
  date = moment().subtract(2, 'days');
}

// Generate list of dates from startDate to today
let tasks = [];
const endDate = moment();
while (date < endDate) {
  const f = function (done) {
    return getAndUploadData(date, (err) => {
      done(err);
    });
  };
  tasks.push(f);
  date = date.add(1, 'day');
}
series(tasks, (err, results) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.info('Everything done successfully!');
  process.exit(0);
});
