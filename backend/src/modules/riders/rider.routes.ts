import { Router } from "express";
import {
  createRider,
  getRiderById,
  listRiders,
  updateRiderAvailability,
  updateRider,
  updateRiderZones,
} from "./rider.controller.js";

const router = Router();

router.route("/").get(listRiders).post(createRider);
router.patch("/:id/availability", updateRiderAvailability);
router.patch("/:id/zones", updateRiderZones);
router.get("/:id", getRiderById);
router.patch("/:id", updateRider);

export default router;
