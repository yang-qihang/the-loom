import os, sys, time
from Xlib import X, display
from Xlib.ext import xtest
_test_display = os.environ.get('LOOM_TEST_DISPLAY', ':99')
if _test_display == ':0' or _test_display.startswith(':0.'):
    raise SystemExit('拒绝在真实桌面 :0 上操作鼠标；请用 :98/:99')
d = display.Display(_test_display)
def click(x, y):
    d.screen().root.warp_pointer(x, y)
    d.sync()
    xtest.fake_input(d, X.ButtonPress, 1); d.sync()
    xtest.fake_input(d, X.ButtonRelease, 1); d.sync()
def key(name):
    import Xlib.XK
    keysym = Xlib.XK.string_to_keysym(name)
    code = d.keysym_to_keycode(keysym)
    xtest.fake_input(d, X.KeyPress, code); d.sync()
    xtest.fake_input(d, X.KeyRelease, code); d.sync()

def combo(mod, name):
    import Xlib.XK
    m = d.keysym_to_keycode(Xlib.XK.string_to_keysym(mod))
    k = d.keysym_to_keycode(Xlib.XK.string_to_keysym(name))
    xtest.fake_input(d, X.KeyPress, m); d.sync()
    xtest.fake_input(d, X.KeyPress, k); d.sync()
    xtest.fake_input(d, X.KeyRelease, k); d.sync()
    xtest.fake_input(d, X.KeyRelease, m); d.sync()
if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'click': click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == 'key': key(sys.argv[2])
    elif cmd == 'combo': combo(sys.argv[2], sys.argv[3])
    elif cmd == 'type':
        for ch in sys.argv[2]:
            key({' ': 'space', '.': 'period', ':': 'colon', '/': 'slash', '@': 'at', '-': 'minus', '_': 'underscore'}.get(ch, ch))
    time.sleep(0.3)
