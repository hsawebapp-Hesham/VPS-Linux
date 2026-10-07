#!/bin/bash
set -e

echo "=== Deploy HSA-Come ==="

sudo rm -rf /var/www/hsa-come/*
sudo cp -a HSA-Come/. /var/www/hsa-come/

echo "=== Checking Nginx ==="
docker exec nginx-vps-site nginx -t

echo "=== Reloading Nginx ==="
docker exec nginx-vps-site nginx -s reload

echo "=== Deploy completed successfully ==="
