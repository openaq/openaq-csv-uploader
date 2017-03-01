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
import { writeFile, unlinkSync } from 'fs';
import { series } from 'async';

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

  uploader.on('end', () => {
    done(null);
  });
};

/**
 * Convert our JSON data into a CSV
 *
 */
const convertToCSV = function (results, done) {
  const options = {
    header: true,
    columns: ['location', 'city', 'country', 'utc', 'local', 'parameter', 'value', 'unit', 'latitude', 'longitude', 'attribution']
  };
  results = results.map((r) => {
    const data = Object.assign({}, r.data);

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

    return data;
  });

  csv(results, options, (err, data) => {
    if (err) {
      done(err);
    }

    done(null, data);
  });
};

/**
 * Get all the data for the day from the database, convert to CSV and upload.
 *
 */
const getAndUploadData = function (date, cb) {
  let yesterday = moment().utc().subtract(1, 'day');
  if (date) {
    yesterday = date.utc().subtract(1, 'day');
  }
  console.info(`Grabbing data for ${yesterday.format('YYYY-MM-DD')}`);
  db.select('data')
    .from('measurements')
    .whereBetween('date_utc', [yesterday.startOf('day').toISOString(), yesterday.endOf('day').toISOString()])
    .then((results) => {
      // Check to make sure we have results
      if (results.length === 0) {
        console.info(`No results found for ${yesterday.format('YYYY-MM-DD')}`);
        return cb();
      }

      // Convert to CSV
      console.info(`Found ${results.length} results for ${yesterday.format('YYYY-MM-DD')}`);
      convertToCSV(results, (err, data) => {
        if (err) {
          console.error(err);
          return cb(err);
        }
        // Save data to disk and then upload to S3
        const file = `${yesterday.format('YYYY-MM-DD')}.csv`;
        writeFile(file, data, (err) => {
          if (err) {
            console.error(err);
            return cb(err);
          }

          uploadToS3(file, (err) => {
            // Remove generated file to be kind
            unlinkSync(file);

            if (err) {
              console.error(err);
              return cb(err);
            }

            // All done!
            console.info(`New file uploaded: ${file}`);
            return cb();
          });
        });
      });
    })
    .catch((err) => {
      console.error(err);
      return cb(err);
    });
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
