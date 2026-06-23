const Zone = require('../models/Zone');
const Rider = require('../models/Rider');

const createZone = async (req, res) => {
  try {
    const { name, city, boundary, stationMaster } = req.body;

    if (!name || !city || !boundary) {
      return res.status(400).json({ message: '区域名称、城市、边界为必填项' });
    }

    const existingZone = await Zone.findOne({ name, city });
    if (existingZone) {
      return res.status(400).json({ message: '该区域已存在' });
    }

    const zone = new Zone({
      name,
      city,
      boundary,
      stationMaster,
    });

    await zone.save();

    if (stationMaster) {
      await Rider.findByIdAndUpdate(stationMaster, {
        isStationMaster: true,
        zone: zone._id,
      });
    }

    res.status(201).json(zone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAllZones = async (req, res) => {
  try {
    const { city } = req.query;
    const query = {};
    if (city) query.city = city;

    const zones = await Zone.find(query)
      .populate('stationMaster', 'name phone');

    res.json(zones);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getZoneById = async (req, res) => {
  try {
    const zone = await Zone.findById(req.params.zoneId)
      .populate('stationMaster', 'name phone');

    if (!zone) {
      return res.status(404).json({ message: '区域不存在' });
    }

    res.json(zone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { name, city, boundary, stationMaster, isActive } = req.body;

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ message: '区域不存在' });
    }

    if (name) zone.name = name;
    if (city) zone.city = city;
    if (boundary) zone.boundary = boundary;
    if (isActive !== undefined) zone.isActive = isActive;

    if (stationMaster !== undefined) {
      if (zone.stationMaster && zone.stationMaster.toString() !== stationMaster) {
        await Rider.findByIdAndUpdate(zone.stationMaster, { isStationMaster: false });
      }
      zone.stationMaster = stationMaster;
      await Rider.findByIdAndUpdate(stationMaster, {
        isStationMaster: true,
        zone: zone._id,
      });
    }

    await zone.save();
    res.json(zone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteZone = async (req, res) => {
  try {
    const { zoneId } = req.params;

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ message: '区域不存在' });
    }

    if (zone.stationMaster) {
      await Rider.findByIdAndUpdate(zone.stationMaster, { isStationMaster: false });
    }

    await Rider.updateMany({ zone: zoneId }, { zone: null });
    await Zone.findByIdAndDelete(zoneId);

    res.json({ message: '区域删除成功' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getZoneRiders = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const riders = await Rider.find({ zone: zoneId })
      .select('-password -todayStats');

    res.json(riders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getZoneByLocation = async (req, res) => {
  try {
    const { longitude, latitude } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ message: '请提供经纬度' });
    }

    const point = {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)],
    };

    const zone = await Zone.findOne({
      boundary: {
        $geoIntersects: { $geometry: point },
      },
    }).populate('stationMaster', 'name phone');

    if (!zone) {
      return res.status(404).json({ message: '该位置不在任何配送区内' });
    }

    res.json(zone);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createZone,
  getAllZones,
  getZoneById,
  updateZone,
  deleteZone,
  getZoneRiders,
  getZoneByLocation,
};
