#!/bin/bash
input=$(cat)
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

if [ -z "$used" ]; then
  exit 0
fi

# Round to integer
used_int=$(printf '%.0f' "$used")

# Calculate bar fill (20 chars wide)
bar_width=20
filled=$(( used_int * bar_width / 100 ))
[ "$filled" -gt "$bar_width" ] && filled=$bar_width
[ "$filled" -lt 0 ] && filled=0
empty=$(( bar_width - filled ))

# Choose color based on threshold
if [ "$used_int" -ge 75 ]; then
  color="\033[31m"   # Red
elif [ "$used_int" -ge 60 ]; then
  color="\033[33m"   # Orange
else
  color="\033[32m"   # Green
fi
reset="\033[0m"

# Build the bar string
bar=""
[ "$filled" -gt 0 ] && bar=$(printf "%${filled}s" | tr ' ' '█')
[ "$empty"  -gt 0 ] && bar="${bar}$(printf "%${empty}s")"

printf "${color}[${bar}] %d%%${reset}" "$used_int"
