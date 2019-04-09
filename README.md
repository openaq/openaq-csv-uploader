**Note this project is no longer supported. Daily updates are deprecated in favor of [other methods](https://medium.com/@openaq/how-in-the-world-do-you-access-air-quality-data-older-than-90-days-on-the-openaq-platform-8562df519ecd).**

OpenAQ CSV Uploader
===

An internal system tool to query the database for data for the day, convert to a CSV and upload to S3.

Any changes made to `master` are automatically run on AWS ECS by Lambda.
