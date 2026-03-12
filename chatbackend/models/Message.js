module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define(
    'Message',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      receiverId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      messageType: {
        type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'file'),
        allowNull: false,
        defaultValue: 'text',
      },
      mediaUrl: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
      mediaMimeType: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      mediaOriginalName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      mediaDurationSec: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
        },
      },
      seen: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'messages',
      underscored: true,
      indexes: [
        { fields: ['sender_id'] },
        { fields: ['receiver_id'] },
        { fields: ['created_at'] },
      ],
    },
  )

  return Message
}
