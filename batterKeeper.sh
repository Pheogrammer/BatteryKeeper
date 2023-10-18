#!/bin/bash
# Get the current battery level
set -x
battery_level=$(upower -i $(upower -e | grep BAT) | grep --color=none -Po '[0-9]+(?=%)')

# If the battery level is greater than or equal to 47%, display a reminder to the user
if [ $battery_level -ge 47 ]; then
  notify-send "Battery Reminder" "Your battery is at 47%. Please remove the charger."
fi