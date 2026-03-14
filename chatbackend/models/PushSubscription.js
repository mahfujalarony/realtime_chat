module.exports = (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define(
    'PushSubscription',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      endpoint: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        unique: true,
      },
      p256dh: {
        type: DataTypes.STRING(512),
        allowNull: false,
      },
      auth: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      contentEncoding: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      expirationTime: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
    },
    {
      tableName: 'push_subscriptions',
      underscored: true,
    },
  )

  return PushSubscription
}

