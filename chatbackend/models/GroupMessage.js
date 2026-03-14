module.exports = (sequelize, DataTypes) => {
  const GroupMessage = sequelize.define(
    'GroupMessage',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      groupId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      senderId: {
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
      mediaGroupId: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      mediaDurationSec: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
        },
      },
    },
    {
      tableName: 'group_messages',
      underscored: true,
      indexes: [
        { fields: ['group_id'] },
        { fields: ['sender_id'] },
        { fields: ['created_at'] },
      ],
    },
  )

  return GroupMessage
}
