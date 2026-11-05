# CPI client half. The server sends this file in the login handshake (lib/loginDelivery.js),
# with the multiplier token below replaced by the configured value. It runs after EveJS's own login
# code, in a private namespace, and patches the client's PI rules in memory:
#
#   planetCommon.GetCPUOutput / GetPowerOutput  command center output per upgrade level
#   BaseLink.GetBaseBandwidth                   logisticalCapacity; GetBandwidthForLevel x 2^level
#   StoragePin.GetCapacity                      storage facilities, launch pads (SpaceportPin)
#                                               and the command center (CommandPin)
#
# The rounding must match lib/multiplier.js exactly. The code must stay ASCII (the server
# writes the payload as ASCII) and valid in Python 2.7, the client's interpreter.
import math

_MULTIPLIER = float('__CPI_MULTIPLIER__')
_STATE_KEY = '_evejsCpiState'


def _builtin(builtins, name):
    if isinstance(builtins, dict):
        return builtins.get(name)
    return getattr(builtins, name, None)


def _install(builtins):
    import eve.common.script.util.planetCommon as planetCommon
    from eve.common.script.planet.entities import baseLink, storagePin

    state = getattr(planetCommon, _STATE_KEY, None)
    if state is None:
        # The first login in this client process: keep the retail functions. A later login
        # reuses them, so wrappers never stack.
        state = {
            'cpu': planetCommon.GetCPUOutput,
            'power': planetCommon.GetPowerOutput,
            'bandwidth': baseLink.BaseLink.__dict__['GetBaseBandwidth'],
            'capacity': storagePin.StoragePin.__dict__['GetCapacity'],
        }
        setattr(planetCommon, _STATE_KEY, state)

    # EveJS's login code makes a new __tidiHandler on every handshake. The multiplier holds
    # only while that handler is the one this handshake saw, so a later login to a server
    # without CPI returns the client to retail without any code from that server.
    state['owner'] = _builtin(builtins, '__tidiHandler')
    state['multiplier'] = _MULTIPLIER

    def current():
        owner = state.get('owner')
        if owner is None or _builtin(builtins, '__tidiHandler') is not owner:
            return 1.0
        return state['multiplier']

    def scale_output(value):
        multiplier = current()
        if multiplier == 1.0:
            return value
        return int(math.floor(value * multiplier + 0.5))

    def scale_capacity(value):
        multiplier = current()
        if multiplier == 1.0 or value is None:
            return value
        return value * multiplier

    def GetCPUOutput(level):
        return scale_output(state['cpu'](level))

    def GetPowerOutput(level):
        return scale_output(state['power'](level))

    def GetBaseBandwidth(self):
        return scale_capacity(state['bandwidth'](self))

    def GetCapacity(self):
        return scale_capacity(state['capacity'](self))

    planetCommon.GetCPUOutput = GetCPUOutput
    planetCommon.GetPowerOutput = GetPowerOutput
    baseLink.BaseLink.GetBaseBandwidth = GetBaseBandwidth
    storagePin.StoragePin.GetCapacity = GetCapacity
    return state['owner'] is not None


try:
    if _install(__builtins__):
        print('CPI:OK:%r' % _MULTIPLIER)
    else:
        print('CPI:INACTIVE:no __tidiHandler')
except Exception:
    import traceback
    traceback.print_exc()
