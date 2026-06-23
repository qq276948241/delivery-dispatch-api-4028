const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  createZone,
  getAllZones,
  getZoneById,
  updateZone,
  deleteZone,
  getZoneRiders,
  getZoneByLocation,
} = require('../controllers/zoneController');

router.get('/', getAllZones);
router.get('/by-location', getZoneByLocation);
router.get('/:zoneId', getZoneById);
router.get('/:zoneId/riders', getZoneRiders);
router.post('/', auth, createZone);
router.put('/:zoneId', auth, updateZone);
router.delete('/:zoneId', auth, deleteZone);

module.exports = router;
