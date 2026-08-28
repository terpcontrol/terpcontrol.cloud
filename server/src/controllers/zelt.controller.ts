import { NextFunction, Response } from 'express';
import { RequestWithUser } from '@interfaces/auth.interface';
import { isUserZeltMiddelware } from '@middlewares/auth.middleware';
import { zeltService } from '@services/zelt.service';

class ZeltController {
  public getZelte = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      // Never auto-mints: an account without tents answers with an empty list.
      res.status(200).json(await zeltService.zelteOfUser(req.user_id));
    } catch (error) {
      next(error);
    }
  };

  public getZelt = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }
      res.status(200).json(await zeltService.zeltOfUser(req.params.zelt_id, req.user_id));
    } catch (error) {
      next(error);
    }
  };
}

export default ZeltController;
