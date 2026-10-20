# Run from the repo root: `just ios build`, `just ios install`, `just ios launch`, `just ios all`,
# `just ios sim`, `just ios testflight`. The modes and their env are listed in app/scripts/ios.sh.

# The Capacitor shell's phone loop, from the root.
ios mode:
    app/scripts/ios.sh {{mode}}
