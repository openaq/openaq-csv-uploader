#!/bin/bash
set -e

docker login -e="$DOCKER_EMAIL" -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"

echo "Pushing image: jflasher/openaq-csv-uploader:$TRAVIS_COMMIT"
docker tag openaq_uploader flasher/openaq-csv-uploader:$TRAVIS_COMMIT
docker push flasher/openaq-csv-uploader:$TRAVIS_COMMIT

# Only push to latest if this is production branch
if [[ $TRAVIS_BRANCH == ${PRODUCTION_BRANCH} ]]; then
  echo "Also pushing as :latest"
  docker tag openaq_uploader flasher/openaq-csv-uploader:latest
  docker push flasher/openaq-csv-uploader:latest

  # And set some vars for the update_task script
  export ENV_FILE="production.env"
  export TASK_NAME="openaq-csv-uploader"
fi

echo "Installing aws cli"
sudo pip install awscli

echo "Running the update_task script"
sh .build_scripts/update-task.sh
