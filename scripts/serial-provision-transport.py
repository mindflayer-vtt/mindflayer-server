#!/usr/bin/env python3
"""Reset an ESP8266 via FTDI RTS, send one validated bundle, and await its result."""
import fcntl
import os
import select
import sys
import termios
import time

if len(sys.argv) != 3:
    raise SystemExit("usage: serial-provision-transport.py <bundle> </dev/serial/by-path/...>")

bundle_path, serial_path = sys.argv[1:]
envelope = open(bundle_path, "rb").read()
fd = os.open(serial_path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
try:
    attributes = termios.tcgetattr(fd)
    attributes[0] = 0
    attributes[1] = 0
    attributes[2] = termios.CS8 | termios.CLOCAL | termios.CREAD
    attributes[3] = 0
    attributes[4] = termios.B115200
    attributes[5] = termios.B115200
    termios.tcsetattr(fd, termios.TCSANOW, attributes)

    # NodeMCU-style FTDI wiring: keep GPIO0 released and pulse reset through RTS.
    # Two pulses enter the keypad's RTC-backed recovery boot before DMA claims RXD0.
    clear_dtr = int(termios.TIOCM_DTR).to_bytes(4, sys.byteorder)
    set_rts = int(termios.TIOCM_RTS).to_bytes(4, sys.byteorder)
    termios.tcflush(fd, termios.TCIFLUSH)
    fcntl.ioctl(fd, termios.TIOCMBIC, clear_dtr)
    for pause_after in (0.5, 1.2):
        fcntl.ioctl(fd, termios.TIOCMBIS, set_rts)
        time.sleep(0.1)
        fcntl.ioctl(fd, termios.TIOCMBIC, set_rts)
        time.sleep(pause_after)
    view = memoryview(envelope)
    while view:
        try:
            written = os.write(fd, view)
            view = view[written:]
        except BlockingIOError:
            select.select([], [fd], [], 1)

    deadline = time.monotonic() + 20
    received = bytearray()
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.25)
        if not ready:
            continue
        try:
            data = os.read(fd, 4096)
        except BlockingIOError:
            continue
        received.extend(data)
        text = received.decode("utf-8", errors="ignore")
        if "PROVISIONING OK" in text:
            mode = "serial recovery" if "SERIAL PROVISIONING MODE" in text else "unprovisioned"
            print(f"Device entered {mode} mode, acknowledged provisioning, and rebooted.")
            raise SystemExit(0)
        if "PROVISIONING ERROR" in text:
            raise SystemExit("Device rejected provisioning envelope")
    raise SystemExit("Timed out waiting for device provisioning acknowledgement")
finally:
    os.close(fd)
