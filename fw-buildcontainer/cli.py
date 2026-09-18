#!/usr/bin/env python3

import typer
import requests
import base64
import os
import sys
from pathlib import Path


if not "FG_AUTOMATION_URL" in os.environ:
  print("FG_AUTOMATION_URL not found in environment, please export")
  exit()

if not "FG_AUTOMATION_TOKEN" in os.environ:
  print("FG_AUTOMATION_TOKEN not found in environment, please export")
  exit()

if not "FG_API_URL" in os.environ:
  print("FG_API_URL not found in environment, please export")
  exit()

if not "FG_MQTT_HOST" in os.environ:
  print("FG_MQTT_HOST not found in environment, please export")
  exit()

if not "FG_MQTT_PORT" in os.environ:
  print("FG_MQTT_PORT not found in environment, please export")
  exit()

API_URL = os.environ["FG_AUTOMATION_URL"]
API_TOKEN = os.environ["FG_AUTOMATION_TOKEN"]
DEV_API_URL = os.environ["FG_API_URL"]
DEV_MQTT_HOST = os.environ["FG_MQTT_HOST"]
DEV_MQTT_PORT = os.environ["FG_MQTT_PORT"]

SERIAL_DEVICE = ""
try:
  SERIAL_DEVICE = os.environ["SERIAL_DEVICE"]
except KeyError:
  SERIAL_DEVICE = '/dev/ttyUSB0'

CONFIG_FILE = "~/.config/fgcli.conf"
os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)

app = typer.Typer()

auth_token = None

# Everything this tool asks of the server is an administrator's, so it speaks
# `/v1` under the same base URL the firmware is built against. The one exception
# is downloading a build's images, which is the device protocol's own route and
# lives at the root, unversioned, because deployed firmware calls it.
V1 = API_URL + "/v1"


def api_auth():
  global auth_token
  response = requests.post(V1 + "/sessions/automation", json={"token": API_TOKEN})
  if not response.ok:
    fail("Automation login refused: " + response.text)
  auth_token = response.json()["userToken"]["token"]

def auth_headers():
  if auth_token == None:
    api_auth()
  return { "Authorization": "Bearer " + auth_token }

def api_get(url, **extra_args):
  return requests.get(V1 + url, headers=auth_headers(), **extra_args)

def api_post(url, **extra_args):
  return requests.post(V1 + url, headers=auth_headers(), **extra_args)

def api_patch(url, **extra_args):
  return requests.patch(V1 + url, headers=auth_headers(), **extra_args)

def api_put(url, **extra_args):
  return requests.put(V1 + url, headers=auth_headers(), **extra_args)

def fail(message: str):
  print(message, file=sys.stderr)
  raise typer.Exit(1)

def problem(response):
  """An error of /v1 is a problem document; its `detail` is the sentence for a human."""
  try:
    return response.json().get("detail") or response.text
  except ValueError:
    return response.text

def api_list(url):
  """Every list of /v1 answers one page and the cursor to continue it with."""
  items = []
  cursor = None
  while True:
    params = { "limit": 200 }
    if cursor:
      params["cursor"] = cursor
    response = api_get(url, params=params)
    if not response.ok:
      fail("GET " + url + " failed: " + problem(response))
    page = response.json()
    items += page["items"]
    cursor = page["nextCursor"]
    if not cursor:
      return items

def find_class(class_name: str):
  """The class a build belongs to, by name. Matched here rather than by a query
  filter, so this tool depends on nothing but the list route itself."""
  for device_class in api_list("/admin/device-classes"):
    if device_class["name"] == class_name:
      return device_class
  fail("Device class not found: " + class_name)

def find_firmware(class_id: str, version: str):
  for firmware in api_list("/admin/firmwares"):
    if firmware["classId"] == class_id and firmware["version"] == version:
      return firmware
  fail("Firmware not found: " + version + " of class " + class_id)

def set_channels(device_class, **channels):
  """Point one or more of a class's channels at a build. `firmwareIds` is written
  whole, so the channels that are not named keep what they had."""
  firmware_ids = dict(device_class["firmwareIds"])
  firmware_ids.update(channels)
  response = api_patch("/admin/device-classes/" + device_class["id"], json={ "firmwareIds": firmware_ids })
  if not response.ok:
    fail("Failed to update device class " + device_class["name"] + ": " + problem(response))
  return response.json()

def gen_provisioning_bin(device_id:str, mqtt_user:str, mqtt_password:str, mqtt_host:str, mqtt_port:str, api_url:str):
  # MQTTS is opt-in: only provision the TLS flag + CA cert when a CA path is
  # supplied. Without them the device keeps using the plaintext listener.
  mqtt_tls = os.environ.get("FG_MQTT_TLS", "")
  mqtt_ca_path = os.environ.get("FG_MQTT_CA_CERT", "")

  provisioning_data= '''\
key,type,encoding,value
fg_provisioning,namespace,,
device_id,data,string,{device_id}
mqtt_user,data,string,{mqtt_user}
mqtt_password,data,string,{mqtt_password}
mqtt_host,data,string,{mqtt_host}
mqtt_port,data,string,{mqtt_port}
api_url,data,string,{api_url}
'''.format(device_id=device_id, mqtt_user=mqtt_user, mqtt_password=mqtt_password, mqtt_host=mqtt_host, mqtt_port=mqtt_port, api_url=api_url)

  if mqtt_ca_path:
    if mqtt_tls in ("1", "true"):
      provisioning_data += "mqtt_tls,data,string,1\n"
    # 'file' encoding reads the PEM contents from the given path into NVS.
    provisioning_data += "mqtt_ca_cert,file,string,{ca}\n".format(ca=mqtt_ca_path)

  open("/tmp/provisioning.csv", 'wt').write(provisioning_data)

  cmd="python3 ~/esp-idf/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py generate /tmp/provisioning.csv /tmp/provisioning.bin 0x3000"
  return os.system(cmd)

def gen_wifi_bin(pssid:str, ppassword:str, sssid:str, spassword:str):
  provisioning_data= '''\
key,type,encoding,value
settings,namespace,,
pssid,data,string,{pssid}
ppassword,data,string,{ppassword}
sssid,data,string,{sssid}
spassword,data,string,{spassword}
'''.format(pssid=pssid, ppassword=ppassword, sssid=sssid, spassword=spassword)

  open("/tmp/wifi.csv", 'wt').write(provisioning_data)

  cmd="python3 ~/esp-idf/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py generate /tmp/wifi.csv /tmp/wifi.bin 0x3000"
  return os.system(cmd)

def create_device_record(class_id: str, device_type: str):
  """A device row made by hand, together with the credentials that are flashed
  into its NVS so it can sign in to the broker.

  There is no route for this on `/v1`: `POST /admin/devices` is handed an id, a
  class and a serial number and answers a device, and the broker credentials are
  deliberately not part of the wire contract - so a device provisioned through it
  would have nothing to connect with. Whatever route takes this over has to
  answer `id`, `serialNumber` and the plaintext `mqtt` pair below.
  """
  fail(
    "Provisioning has no route on /v1: nothing there creates a device and answers the broker\n"
    "credentials and serial number that are flashed into it. Flash from a stack that still serves\n"
    "the old API, or add the route before provisioning hardware here."
  )


@app.command()
def version():
  """This tool's own version."""
  print("Fridgegrow CLI")
  print("V 0.0.0")


@app.command()
def provision(class_name:str, device_type: str):
  """Flash a factory-fresh device over USB and print its serial number.

  Unavailable until `/v1` grows a route that answers a new device's broker
  credentials - see `create_device_record`.
  """
  device_class = find_class(class_name)
  class_id = device_class["id"]
  firmware_id = device_class["firmwareIds"]["stable"]
  if not firmware_id:
    fail("Device class " + class_name + " has no build on its stable channel to flash.")

  # The images come from the device protocol's own download route, which is
  # unversioned and public because deployed firmware reads its updates there.
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/bootloader.bin")
  open("/tmp/bootloader.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/partitions.bin")
  open("/tmp/partitions.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/boot_app0.bin")
  open("/tmp/bootapp.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/firmware.bin")
  open("/tmp/firmware.bin", 'wb').write(response.content)

  device = create_device_record(class_id, device_type)
  if gen_provisioning_bin(device["id"], device["mqtt"]["username"], device["mqtt"]["password"], DEV_MQTT_HOST, DEV_MQTT_PORT, DEV_API_URL):
    print("error flashing firmware, aborting...", file=sys.stderr)
    return

  esptool_args = [
    "--chip", "esp32",
    "--port", SERIAL_DEVICE,
    "--baud", "460800",
    "--before", "default_reset",
    "--after", "hard_reset write_flash",
    "-z",
    "--erase-all",
    "--flash_mode", "dio",
    "--flash_freq", "40m",
    "--flash_size", "detect",
    "0x1000", "/tmp/bootloader.bin",
    "0x8000", "/tmp/partitions.bin",
    "0xe000", "/tmp/bootapp.bin",
    "0x10000", "/tmp/firmware.bin",
    "0x610000", "/tmp/provisioning.bin"
  ]

  cmd = 'python3 ~/.platformio/packages/tool-esptoolpy/esptool.py ' + ' '.join(esptool_args)  
  if(os.system(cmd)):
    print("error flashing firmware, aborting...", file=sys.stderr)
    return

  cmd="python3 ~/.platformio/packages/tool-esptoolpy/esptool.py --port " + SERIAL_DEVICE + " write_flash 0x610000 /tmp/provisioning.bin"
  if(os.system(cmd)):
    print("error flashing provisioning binary, aborting...", file=sys.stderr)
    return
  
  os.system("sed \"s/SERIALNUMBER/" + str(device['serialNumber']).zfill(6) + "/g\" /usr/share/plantalytix.zpl > /print/label.zpl")

  print(device['serialNumber'])

@app.command()
def create_fw(name:str, version:str):
  """Register a build of the device class named by `name` and print its id."""
  device_class = find_class(name)
  response = api_post("/admin/firmwares", json={
    "classId": device_class["id"],
    "name": name,
    "version": version
  })
  if not response.ok:
    fail("Failed to register the build: " + problem(response))
  print(response.json()["id"])

@app.command()
def upload_fw(firmware_id:str, name:str, file:Path):
  """Upload one of the images that make up a build."""
  response = api_put("/admin/firmwares/" + firmware_id + "/binaries/" + name, json={
    "data": base64.b64encode(open(file, "rb").read()).decode()
  })
  if not response.ok:
    fail("Failed to upload " + name + ": " + problem(response))
  print(name + " uploaded to " + firmware_id)

@app.command()
def list_fw():
  """Every registered build."""
  print("ID\t\t\t\t\tNAME\tVERSION")
  for fw in api_list("/admin/firmwares"):
    print(fw["id"] + "\t" + (fw["name"] or "") + "\t" + fw["version"])

@app.command()
def rollout(firmware_name:str, firmware_version:str, class_name:str):
  """Put the named build on the stable channel of a device class."""
  firmware = find_firmware(find_class(firmware_name)["id"], firmware_version)
  set_channels(find_class(class_name), stable=firmware["id"])
  print("stable firmware of " + class_name + " is now " + firmware["id"])

@app.command()
def rollout_id(firmware_id:str, class_name:str):
  """Put a build on the stable and beta channels of a device class."""
  set_channels(find_class(class_name), stable=firmware_id, beta=firmware_id)
  print("stable and beta firmware of " + class_name + " is now " + firmware_id)

@app.command()
def rollout_alpha(firmware_id:str, class_name:str):
  """Put a build on the alpha channel, leaving beta and stable where they are."""
  set_channels(find_class(class_name), alpha=firmware_id)
  print("alpha firmware of " + class_name + " is now " + firmware_id)

@app.command()
def create_class(name:str, description:str):
  """Create a device class. No channel points anywhere until a build is rolled out."""
  response = api_post("/admin/device-classes", json={
    "name": name,
    "description": description,
    "concurrentUpdates": 1,
    "maxFailures": 1,
    "firmwareIds": { "stable": None, "beta": None, "alpha": None },
    "rollout": { "paused": False, "percent": 100 }
  })
  if not response.ok:
    fail("Failed to create the device class: " + problem(response))
  print(response.json()["id"])


@app.command()
def classes():
  """Every device class."""
  print("ID\t\t\t\t\tNAME\tDESCRIPTION")
  for device_class in api_list("/admin/device-classes"):
    print(device_class["id"] + "\t" + device_class["name"] + "\t" + (device_class["description"] or ""))

@app.command()
def create_device(class_name: str, device_type: str):
  """Create a device record without flashing anything.

  Unavailable for the same reason `provision` is - see `create_device_record`.
  """
  print(create_device_record(find_class(class_name)["id"], device_type))

if __name__ == "__main__":
  app()