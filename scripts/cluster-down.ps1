# Deletes the local k3d cluster "urumi".
# WARNING: this deletes ALL cluster data (databases, volumes, secrets). To pause
# without losing data use:  k3d cluster stop urumi
$ErrorActionPreference = 'Stop'
k3d cluster delete urumi
