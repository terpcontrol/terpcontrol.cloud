import { Router } from 'express';
import MqttAuthController from '@controllers/mqttauth.controller';
import { Routes } from '@interfaces/routes.interface';
import { mqttAuthSecretMiddleware } from '@middlewares/mqttauth.middleware';

// Internal RabbitMQ HTTP auth backend - intentionally excluded from the public OpenAPI docs.
class MqttAuthRoute implements Routes {
  public path = '/mqttauth/:secret/';
  public router = Router();
  public authController = new MqttAuthController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    this.router.use(this.path, mqttAuthSecretMiddleware);
    this.router.post(`${this.path}user`, this.authController.user);
    this.router.post(`${this.path}vhost`, this.authController.vhost);
    this.router.post(`${this.path}topic`, this.authController.topic);
    this.router.post(`${this.path}resource`, this.authController.resource);
  }
}

export default MqttAuthRoute;
