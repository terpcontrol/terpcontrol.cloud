#!/usr/bin/env python3

import typer
import requests
import pickle
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

# Boards with a USB-UART bridge (CP2102 on the Heltec) show up as ttyUSB*,
# boards talking native USB (ESP32-S3) as ttyACM*. An empty override counts as
# unset -- the wrapper scripts always pass the variable through, set or not.
SERIAL_DEVICE = os.environ.get("SERIAL_DEVICE", "").strip() or next(
  (dev for dev in ('/dev/ttyUSB0', '/dev/ttyACM0') if os.path.exists(dev)),
  '/dev/ttyUSB0')

ESP_CHIP = os.environ.get("ESP_CHIP", "").strip() or "esp32"

# Offset of the read-only provisioning NVS partition. Depends on the board's
# partition table: 0x610000 for the 8MB boards (fg_partitions.csv), 0x3F0000
# for the 4MB headless board (fg_partitions_4mb.csv).
NVS_RO_OFFSET = os.environ.get("NVS_RO_OFFSET", "").strip() or "0x610000"

# The original ESP32 keeps its second-stage bootloader at 0x1000; every later
# target (S2/S3/C3) expects it at 0x0.
BOOTLOADER_OFFSET = "0x1000" if ESP_CHIP == "esp32" else "0x0"

CONFIG_FILE = "~/.config/fgcli.conf"
os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)

app = typer.Typer()

auth_token = None
refresh_token = None


def api_auth():
  global auth_token
  response = requests.post(API_URL + "/tokenlogin", json={"token": API_TOKEN})
  auth_token = response.json()['userToken']['token']

def api_get(url, **extra_args):
  if(auth_token == None):
    api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  return requests.get(API_URL + url, headers=headers, **extra_args)

def api_post(url, **extra_args):
  if(auth_token == None):
    api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  return requests.post(API_URL + url, headers=headers, **extra_args)

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

@app.command()
def version():
  print("Fridgegrow CLI")
  print("V 0.0.0")


@app.command()
def provision(class_name:str, device_type: str):
  device_class = api_get("/device/class/find/" + class_name)
  if(not (device_class and device_class.json()["class_id"])):
    print("Device class not found!", file=sys.stderr)
    exit(1)

  class_id = device_class.json()["class_id"]  
  response = api_get("/device/class/" + class_id)
  firmware_id = response.json()["firmware_id"]  

  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/bootloader.bin")
  open("/tmp/bootloader.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/partitions.bin")
  open("/tmp/partitions.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/boot_app0.bin")
  open("/tmp/bootapp.bin", 'wb').write(response.content)
  response = requests.get(API_URL + "/device/firmware/" + firmware_id + "/firmware.bin")
  open("/tmp/firmware.bin", 'wb').write(response.content)

  response = api_post("/device/create", json={
    "class_id": class_id,
    "device_type": device_type
  })
  device = response.json()  
  if gen_provisioning_bin(device["device_id"], device["username"], device["password"], DEV_MQTT_HOST, DEV_MQTT_PORT, DEV_API_URL):
    print("error flashing firmware, aborting...", file=sys.stderr)
    return

  esptool_args = [
    "--chip", ESP_CHIP,
    "--port", SERIAL_DEVICE,
    "--baud", "460800",
    "--before", "default_reset",
    "--after", "no_reset write_flash",
    "-z",
    "--erase-all",
    "--flash_mode", "dio",
    "--flash_freq", "40m",
    "--flash_size", "detect",
    BOOTLOADER_OFFSET, "/tmp/bootloader.bin",
    "0x8000", "/tmp/partitions.bin",
    "0xe000", "/tmp/bootapp.bin",
    "0x10000", "/tmp/firmware.bin",
    NVS_RO_OFFSET, "/tmp/provisioning.bin"
  ]

  cmd = 'python3 ~/.platformio/packages/tool-esptoolpy/esptool.py ' + ' '.join(esptool_args)  
  if(os.system(cmd)):
    print("error flashing firmware, aborting...", file=sys.stderr)
    return

  cmd=("python3 ~/.platformio/packages/tool-esptoolpy/esptool.py --chip " + ESP_CHIP
       + " --port " + SERIAL_DEVICE + " --before no_reset --after hard_reset"
       + " write_flash " + NVS_RO_OFFSET + " /tmp/provisioning.bin")
  if(os.system(cmd)):
    print("error flashing provisioning binary, aborting...", file=sys.stderr)
    return
  
  os.system("sed \"s/SERIALNUMBER/" + str(device['serialnumber']).zfill(6) + "/g\" /usr/share/plantalytix.zpl > /print/label.zpl")

  print(device['serialnumber'])

@app.command()
def create_fw(name:str, version:str):
  api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  data = {
    "name": name,
    "version": version
  }
  response = requests.post(API_URL + "/device/firmware", headers=headers, data=data)
  print(response.json()["firmware_id"])

@app.command()
def upload_fw(firmware_id:str, name:str, file:Path):
  api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  data = {
    "name": name,
    "version": version
  }
  files = {
    "binary": open(file, "rb"),
  }
  response = requests.post(API_URL + "/device/firmware/" + firmware_id + "/" + name, headers=headers, files=files, data=data)
  print(response.json())

@app.command()
def list_fw():
  api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  response = requests.get(API_URL + "/device/firmware", headers=headers)

  print("ID\t\t\t\t\tNAME\tVERSION")
  for fw in response.json():
    print(fw["firmware_id"] + "\t" + fw["name"] + "\t" + fw["version"])

@app.command()
def rollout(firmware_name:str, firmware_version:str, class_name:str):
  device_class = api_get("/device/class/find/" + class_name)
  if(not (device_class and device_class.json()["class_id"])):
    print("Device class not found!")
    exit()

  firmware = api_get("/device/firmware/find?name=" + firmware_name + "&version=" + firmware_version)
  if(not (firmware and firmware.json()["firmware_id"])):
    print("Firmware not found!")
    exit()

  print(device_class.json())
  print(firmware.json())

  response = api_post("/device/class/" + device_class.json()["class_id"], json={
    "name": device_class.json()["name"],
    "description": device_class.json()["description"],
    "firmware_id": firmware.json()["firmware_id"]
  })

  print(response)

@app.command()
def rollout_id(firmware_id:str, class_name:str):
  device_class = api_get("/device/class/find/" + class_name)
  if(not (device_class and device_class.json()["class_id"])):
    print("Device class not found!")
    exit()

  response = api_post("/device/class/" + device_class.json()["class_id"], json={
    "name": device_class.json()["name"],
    "description": device_class.json()["description"],
    "firmware_id": firmware_id,
    "beta_firmware_id": firmware_id,
    "concurrent": device_class.json()["concurrent"],
    "maxfails": device_class.json()["maxfails"]
  })

  print(response)

@app.command()
def rollout_alpha(firmware_id:str, class_name:str):
  device_class = api_get("/device/class/find/" + class_name)
  if(device_class.status_code != 200 or not device_class.json().get("class_id")):
    print("Device class not found: " + class_name, file=sys.stderr)
    exit(1)

  info = device_class.json()
  update = {
    "name": info["name"],
    "description": info.get("description") or "",
    "firmware_id": info.get("firmware_id") or "",
    "alpha_firmware_id": firmware_id,
    "concurrent": info.get("concurrent", 1),
    "maxfails": info.get("maxfails", 1)
  }
  # The update always writes firmware_id, so the current one is sent back
  # unchanged; beta is only written when it is part of the request, so a class
  # without one keeps it that way.
  if info.get("beta_firmware_id"):
    update["beta_firmware_id"] = info["beta_firmware_id"]

  response = api_post("/device/class/" + info["class_id"], json=update)
  if(not response.ok):
    print("Failed to set alpha firmware: " + response.text, file=sys.stderr)
    exit(1)

  print("alpha firmware of " + class_name + " is now " + firmware_id)

@app.command()
def create_class(name:str, description:str):
  api_auth()
  headers = { "Authorization": "Bearer " + auth_token }
  response = requests.post(API_URL + "/device/class", headers=headers, json={
    "name": name,
    "description": description,
    "firmware_id": "",
    "concurrent": 1,
    "maxfails": 1
  })
  print(response.json())


@app.command()
def classes():
  response = api_get("/device/class")
  print("ID\t\t\t\t\tNAME\tVERSION")
  for fw in response.json():
    print(fw["class_id"] + "\t" + fw["name"] + "\t" + fw["description"])

@app.command()
def create_device(class_name: str, device_type: str):
  device_class = api_get("/device/class/find/" + class_name)
  print(device_class.json())
  if(device_class and device_class.json()["class_id"]):
    class_id = device_class.json()["class_id"]
    print(class_id)
    response = api_post("/device/create", json={
      "class_id": class_id,
      "device_type": device_type
    })
    print(response.json())

if __name__ == "__main__":
  app()