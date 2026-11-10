# CPI client half. The server sends this file in the login handshake (lib/loginDelivery.js),
# with the settings token below replaced by the configured values. It runs after EveJS's own login
# code, in a private namespace, and patches the client's PI rules in memory:
#
#   planetCommon.GetCPUOutput / GetPowerOutput  command center output per upgrade level
#   BaseLink.GetBaseBandwidth                   logisticalCapacity; GetBandwidthForLevel x 2^level
#   StoragePin.GetCapacity                      storage facilities, launch pads (SpaceportPin)
#                                               and the command center (CommandPin)
#   SchematicsLoader.GetData                    the schematic table: each schematic's cycleTime,
#                                               by the tier of its product
#
# Every client reader of a schematic, including ProcessPin.SetSchematic (simulation, progress
# bars, route bandwidth) and the picker and tooltips, asks SchematicsLoader.GetData for the table
# at call time, so patching that one class method reaches them all, whenever they were imported.
#
# The rounding must match lib/multiplier.js exactly. The code must stay ASCII (the server
# writes the payload as ASCII) and valid in Python 2.7, the client's interpreter.
import math

_SETTINGS = __CPI_SETTINGS__
_STATE_KEY = '_evejsCpiState'
_RETAIL = dict((key, 1.0) for key in _SETTINGS)

# A schematic's tier is its product's item group (inventorycommon const.py:1203-1206).
_TIER_BY_GROUP = {1042: 1, 1034: 2, 1040: 3, 1041: 4}
_DURATION_SETTING_BY_TIER = {
    1: 'piP1SchematicDurationMultiplier',
    2: 'piP2SchematicDurationMultiplier',
    3: 'piP3SchematicDurationMultiplier',
    4: 'piP4SchematicDurationMultiplier',
}


def _builtin(builtins, name):
    if isinstance(builtins, dict):
        return builtins.get(name)
    return getattr(builtins, name, None)


def scale_output(value, multiplier):
    if multiplier == 1.0:
        return value
    return int(math.floor(value * multiplier + 0.5))


def scale_capacity(value, multiplier):
    if multiplier == 1.0 or value is None:
        return value
    return value * multiplier


def scale_duration(seconds, multiplier):
    if multiplier == 1.0:
        return seconds
    return max(1, int(math.floor(seconds * multiplier + 0.5)))


class _ScaledSchematic(object):
    # One schematic with a scaled cycleTime; every other attribute is the compiled original's.
    __slots__ = ('_schematic', 'cycleTime')

    def __init__(self, schematic, cycleTime):
        self._schematic = schematic
        self.cycleTime = cycleTime

    def __getattr__(self, name):
        return getattr(self._schematic, name)


class _ScaledSchematics(object):
    # The schematic table as the client's readers use it (fsdBuiltData/common/planet.py:78-118):
    # get, iteritems, keys, in, []. Rows come back through scale(schematic_id, schematic). The
    # other ways to reach a row (items, values, itervalues) are scaled too, because __getattr__
    # would otherwise hand them the compiled table and its retail rows.
    __slots__ = ('_table', '_scale')

    def __init__(self, table, scale):
        self._table = table
        self._scale = scale

    def get(self, schematic_id, default=None):
        schematic = self._table.get(schematic_id, None)
        if schematic is None:
            return default
        return self._scale(schematic_id, schematic)

    def __getitem__(self, schematic_id):
        return self._scale(schematic_id, self._table[schematic_id])

    def __contains__(self, schematic_id):
        return schematic_id in self._table

    def __iter__(self):
        return iter(self._table)

    def __len__(self):
        return len(self._table)

    def keys(self):
        return self._table.keys()

    def iteritems(self):
        for schematic_id, schematic in self._table.iteritems():
            yield (schematic_id, self._scale(schematic_id, schematic))

    def items(self):
        return list(self.iteritems())

    def itervalues(self):
        for schematic_id, schematic in self.iteritems():
            yield schematic

    def values(self):
        return list(self.itervalues())

    def __getattr__(self, name):
        return getattr(self._table, name)


def _install(builtins):
    import eve.common.script.util.planetCommon as planetCommon
    from eve.common.script.planet.entities import baseLink, storagePin
    import fsdBuiltData.common.planet as fsdPlanet
    import evetypes

    state = getattr(planetCommon, _STATE_KEY, None)
    if state is None:
        # The first login in this client process: keep the retail functions. A later login
        # reuses them, so wrappers never stack.
        state = {
            'cpu': planetCommon.GetCPUOutput,
            'power': planetCommon.GetPowerOutput,
            'bandwidth': baseLink.BaseLink.__dict__['GetBaseBandwidth'],
            'capacity': storagePin.StoragePin.__dict__['GetCapacity'],
            'schematics': fsdPlanet.SchematicsLoader.GetData,
            'tiers': {},
        }
        setattr(planetCommon, _STATE_KEY, state)
    elif 'schematics' not in state:
        # A login to a CPI 1.0 server earlier in this process kept no schematic state.
        state['schematics'] = fsdPlanet.SchematicsLoader.GetData
        state['tiers'] = {}

    # EveJS's login code makes a new __tidiHandler on every handshake. The settings hold only
    # while that handler is the one this handshake saw, so a later login to a server without
    # CPI returns the client to retail without any code from that server.
    state['owner'] = _builtin(builtins, '__tidiHandler')
    state['settings'] = _SETTINGS
    state.pop('multiplier', None)

    def current():
        owner = state.get('owner')
        if owner is None or _builtin(builtins, '__tidiHandler') is not owner:
            return _RETAIL
        return state.get('settings', _RETAIL)

    def GetCPUOutput(level):
        return scale_output(state['cpu'](level), current()['piCommandCenterFittingMultiplier'])

    def GetPowerOutput(level):
        return scale_output(state['power'](level), current()['piCommandCenterFittingMultiplier'])

    def GetBaseBandwidth(self):
        return scale_capacity(state['bandwidth'](self), current()['piConnectionBandwidthMultiplier'])

    def GetCapacity(self):
        return scale_capacity(state['capacity'](self), current()['piStorageCapacityMultiplier'])

    def tier_of(schematic_id, schematic):
        tiers = state['tiers']
        if schematic_id not in tiers:
            tier = None
            for type_id, commodity in schematic.types.iteritems():
                if not commodity.isInput:
                    output_tier = _TIER_BY_GROUP.get(evetypes.GetGroupID(type_id))
                    if output_tier is not None and (tier is None or output_tier > tier):
                        tier = output_tier
            tiers[schematic_id] = tier
        return tiers[schematic_id]

    def scale_schematic(schematic_id, schematic):
        tier = tier_of(schematic_id, schematic)
        if tier is None:
            return schematic
        multiplier = current()[_DURATION_SETTING_BY_TIER[tier]]
        if multiplier == 1.0:
            return schematic
        return _ScaledSchematic(schematic, scale_duration(schematic.cycleTime, multiplier))

    def GetData(cls):
        table = state['schematics']()
        settings = current()
        if table is None or all(settings[key] == 1.0 for key in _DURATION_SETTING_BY_TIER.values()):
            return table
        return _ScaledSchematics(table, scale_schematic)

    planetCommon.GetCPUOutput = GetCPUOutput
    planetCommon.GetPowerOutput = GetPowerOutput
    baseLink.BaseLink.GetBaseBandwidth = GetBaseBandwidth
    storagePin.StoragePin.GetCapacity = GetCapacity
    fsdPlanet.SchematicsLoader.GetData = classmethod(GetData)
    return state['owner'] is not None


def _describe(settings):
    changed = ['%s x%r' % (key, settings[key]) for key in sorted(settings) if settings[key] != 1.0]
    return ', '.join(changed) or 'retail'


try:
    if _install(__builtins__):
        print('CPI:OK:%s' % _describe(_SETTINGS))
    else:
        print('CPI:INACTIVE:no __tidiHandler')
except Exception:
    import traceback
    traceback.print_exc()
