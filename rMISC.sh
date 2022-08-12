#!/bin/bash

rsync -av --delete --exclude .git --exclude public/build/ /home/asa/repos/AppExplorer/ /home/asa/repos/misc/asaayers/AppExplorer/