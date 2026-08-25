import { NextFunction, Response } from 'express';
import { RequestWithUser } from '@interfaces/auth.interface';
import dingModel from '@models/ding.model';
import { isUserZeltMiddelware } from '@middlewares/auth.middleware';
import { schluesselService } from '@services/schluessel.service';

class SchluesselController {
  /**
   * Mints the tent's read key - the one pasted into an export script or a
   * spreadsheet. Owner only, and the token is in this response and nowhere else:
   * only its hash is stored, so a lost key is reissued rather than looked up.
   * Minting again rotates, and the previous token stops working as this returns.
   */
  public postZugangsschluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }
      res.status(200).json(await schluesselService.minteZugangsschluessel(req.params.zelt_id));
    } catch (error) {
      next(error);
    }
  };

  /**
   * Mints a club write key for one person in this tent. The `mensch` has to
   * exist here first, because the key writes as them: `akteur` comes from this
   * binding and never from a request body, which is what stops the shared tent
   * phone attributing Anna's pour to Ben.
   */
  public postSchluessel = async (req: RequestWithUser, res: Response, next: NextFunction) => {
    try {
      if (!(await isUserZeltMiddelware(req, res, req.params.zelt_id))) {
        return;
      }

      const mensch_ding_id = typeof req.body?.mensch_ding_id === 'string' ? req.body.mensch_ding_id : '';
      if (!mensch_ding_id || !(await dingModel.exists({ ding_id: mensch_ding_id, zelt_id: req.params.zelt_id, art: 'mensch' }))) {
        res.status(400).json({ message: 'mensch_ding_id must be the ding_id of a mensch in this Zelt' });
        return;
      }

      res.status(200).json(await schluesselService.minteSchluessel(req.params.zelt_id, mensch_ding_id));
    } catch (error) {
      next(error);
    }
  };
}

export default SchluesselController;
