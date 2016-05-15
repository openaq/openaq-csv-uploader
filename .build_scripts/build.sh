#!/bin/bash
set -e

echo No build currently needed since we can not cache because we are on Travis legacy systems.

# if [ -f $HOME/docker/openaq_uploader.tar ]
# then
#   echo "Loading cached worker image"
#   docker load < $HOME/docker/openaq_uploader.tar
# fi

# touch local.env
# docker-compose --project openaq build

# mkdir -p $HOME/docker
# echo "Caching openaq_uploader docker image."
# docker save openaq_uploader > $HOME/docker/openaq_uploader.tar
