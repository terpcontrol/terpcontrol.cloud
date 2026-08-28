/** The fields RabbitMQ's HTTP auth backend posts, per check. */
export interface AuthUserDto {
  username: string;
  password: string;
  vhost: string;
  client_id: string;
}

export interface AuthVhostDto {
  username: string;
  vhost: string;
  ip: string;
  client_id: string;
}

export interface AuthTopicDto {
  username: string;
  resource: string;
  name: string;
  permission: string;
  tags: string;
  routing_key: string;
  'variable_map.client_id': string;
}

export interface AuthResourceDto {
  username: string;
  vhost: string;
  resource: string;
  permission: string;
  tags: string;
  client_id: string;
  name: string;
}
