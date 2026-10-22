import { Router, type IRouter } from "express";
import healthRouter from "./health";
import manaraRouter from "./manara";

const router: IRouter = Router();

router.use(healthRouter);
router.use(manaraRouter);

export default router;
